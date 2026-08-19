import { spawn } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizedContentSchema } from "../connectors/types";
import { clusterCrossSourceTopics } from "../clustering/cross-source";
import { ensureDailyBrief } from "../daily-brief/generate";
import { ensureSource,finishSyncRun,persistNormalizedContent,startSyncRun } from "../services/ingest";
import { enqueueGetNotesProcessing } from "../services/get-notes-processing";

type Blogger={follow_id:string|number;account_name:string;account_icon?:string;platform?:string;account_url?:string};
type ContentSummary={post_id_alias:string;post_title?:string;post_summary?:string;post_type?:string;publish_time?:string};
type ContentDetail={post_name?:string;post_title?:string;post_summary?:string;post_media_text?:string;post_subtitle?:string;post_url?:string;post_publish_time?:string;post_create_time?:string;post_type?:string};

let nextCliRequestAt=0;export function getNotesBackoffMs(attempt:number,random=Math.random()){return Math.min(30_000,1_000*2**Math.max(0,attempt-1))+Math.floor(random*500);}
async function rateLimit(){const qps=Math.max(.1,Number(process.env.GET_NOTES_QPS??1));const wait=Math.max(0,nextCliRequestAt-Date.now());if(wait)await new Promise(resolve=>setTimeout(resolve,wait));nextCliRequestAt=Date.now()+Math.ceil(1000/qps);}
export async function runGetNote(args:string[],timeoutMs=30_000,options:{retries?:number;onRateLimit?:()=>void}={}):Promise<unknown>{for(let attempt=1;attempt<=(options.retries??4);attempt+=1){await rateLimit();try{return await new Promise((resolve,reject)=>{const child=spawn("getnote",[...args,"-o","json"],{stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>{stdout+=String(chunk)});child.stderr.on("data",chunk=>{stderr+=String(chunk)});const timer=setTimeout(()=>{child.kill("SIGTERM");reject(new Error("Get 笔记 CLI 超时"))},timeoutMs);child.on("close",code=>{clearTimeout(timer);if(code!==0)return reject(new Error(stderr.trim()||`Get 笔记 CLI 退出 ${code}`));try{resolve(JSON.parse(stdout))}catch{reject(new Error("Get 笔记 CLI 返回了无效 JSON"))}});});}catch(error){const message=error instanceof Error?error.message:String(error);const limited=/429|qps|rate.?limit|too many/i.test(message);if(!limited||attempt>=(options.retries??4))throw error;options.onRateLimit?.();await new Promise(resolve=>setTimeout(resolve,getNotesBackoffMs(attempt)));}}throw new Error("Get 笔记重试耗尽");}

function dateTime(value:string|undefined){if(!value)return null;const parsed=new Date(value.includes("T")?value:`${value.replace(" ","T")}+08:00`);return Number.isNaN(parsed.getTime())?null:parsed.toISOString();}
function todayInBeijing(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date());}
async function mapLimit<T,R>(items:T[],limit:number,handler:(item:T)=>Promise<R>){const output:R[]=[];let cursor=0;async function worker(){while(cursor<items.length){const index=cursor++;output[index]=await handler(items[index]);}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return output;}

type Runner=(args:string[],timeoutMs?:number)=>Promise<unknown>;
async function listBloggers(knowledgeBaseId:string,run:Runner){
  const bloggers:Blogger[]=[];let page=1,hasMore=true;
  while(hasMore && page<=20){const payload=await run(["kb","bloggers",knowledgeBaseId,"--page",String(page)]) as {data?:{bloggers?:Blogger[];has_more?:boolean}};bloggers.push(...(payload.data?.bloggers ?? []));hasMore=Boolean(payload.data?.has_more);page+=1;}
  return bloggers;
}

async function listContentPage(knowledgeBaseId:string,followId:string,page:number,run:Runner){
  const payload=await run(["kb","blogger-contents",knowledgeBaseId,followId,"--page",String(page)]) as {data?:{contents?:ContentSummary[];has_more?:boolean}};
  return{items:payload.data?.contents ?? [],hasMore:Boolean(payload.data?.has_more)};
}

async function contentDetail(knowledgeBaseId:string,postId:string,run:Runner){
  const payload=await run(["kb","blogger-content",knowledgeBaseId,postId],60_000) as {data?:ContentDetail};
  if(!payload.data)throw new Error(`Get 笔记正文 ${postId} 不存在`);return payload.data;
}

export async function syncGetNotesCli(admin:SupabaseClient,workspaceId:string,options:{knowledgeBaseId?:string;initialDays?:number;maxPagesPerBlogger?:number;concurrency?:number}={},progress:((metrics:Record<string,unknown>)=>Promise<void>)=async()=>{}){
  const knowledgeBaseId=options.knowledgeBaseId ?? process.env.GET_NOTES_KNOWLEDGE_BASE_ID ?? "J9o7AMeY";
  const source=await ensureSource(admin,{workspaceId,type:"get_notes",externalId:knowledgeBaseId,name:"Get 笔记 · 竞品博主",processingMode:"automatic_deep",metadata:{mode:"cli",knowledgeBaseId,provenance:"verified_live"}});
  const runId=await startSyncRun(admin,{workspaceId,sourceId:source.id});let fetched=0,normalized=0,duplicates=0,bloggerCount=0,detailReads=0,rateLimitCount=0,processedBloggers=0;const failures:Array<{creator:string;error:string}>=[];const runner:Runner=(args,timeout)=>runGetNote(args,timeout,{onRateLimit:()=>{rateLimitCount+=1}});
  try{
    const bloggers=await listBloggers(knowledgeBaseId,runner);bloggerCount=bloggers.length;
    const {error:subscriptionError}=await admin.from("source_subscriptions").upsert(bloggers.map((blogger)=>({workspace_id:workspaceId,source_id:source.id,external_id:String(blogger.follow_id),name:blogger.account_name,enabled:true,muted:false,metadata:{platform:blogger.platform ?? "other",iconUrl:blogger.account_icon || null,accountUrl:blogger.account_url || null,knowledgeBaseId}})),{onConflict:"workspace_id,source_id,external_id"});
    if(subscriptionError)throw new Error(subscriptionError.message);
    const {data:subscriptions,error:readError}=await admin.from("source_subscriptions").select("id,external_id,name,metadata").eq("source_id",source.id).eq("enabled",true).eq("muted",false);if(readError)throw new Error(readError.message);const resumeId=typeof source.metadata.resumeSubscriptionId==="string"?source.metadata.resumeSubscriptionId:null;const ordered=[...(subscriptions??[])];if(resumeId){const index=ordered.findIndex(item=>item.id===resumeId);if(index>0)ordered.push(...ordered.splice(0,index));}
    for(const subscription of ordered){
      await progress({phase:"get_notes_bloggers",currentBlogger:subscription.name,processedBloggers,totalBloggers:ordered.length,discoveredContent:fetched,detailReads,rateLimitCount});
      const previous=subscription.metadata && typeof subscription.metadata === "object" ? subscription.metadata as Record<string,unknown> : {};
      const since=typeof previous.lastContentPublishedAt === "string" ? previous.lastContentPublishedAt : new Date(Date.now()-(options.initialDays ?? 7)*86_400_000).toISOString();
      let page=1,hasMore=true,reachedOld=false;let latest=since;
      try{
        while(hasMore && !reachedOld && page<=(options.maxPagesPerBlogger ?? 10)){
          const list=await listContentPage(knowledgeBaseId,subscription.external_id,page,runner);fetched+=list.items.length;
          const details=await mapLimit(list.items,options.concurrency ?? 2,async(summary)=>({summary,detail:await contentDetail(knowledgeBaseId,summary.post_id_alias,runner)}));detailReads+=details.length;
          const recent=details.filter(({summary,detail})=>{const publishedAt=dateTime(detail.post_publish_time ?? summary.publish_time);if(publishedAt&&publishedAt<=since){reachedOld=true;return false}if(publishedAt&&publishedAt>latest)latest=publishedAt;return true});
          await mapLimit(recent,options.concurrency ?? 4,async({summary,detail})=>{
            const publishedAt=dateTime(detail.post_publish_time ?? summary.publish_time);
            const title=(detail.post_name ?? detail.post_title ?? summary.post_title ?? "未命名竞品内容").trim();const body=detail.post_media_text ?? detail.post_name ?? null;
            const normalizedItem=normalizedContentSchema.parse({externalId:summary.post_id_alias,contentType:detail.post_type ?? summary.post_type ?? "article",title,summary:detail.post_summary ?? summary.post_summary ?? null,body,author:subscription.name,canonicalUrl:detail.post_url || null,publishedAt:publishedAt ?? dateTime(detail.post_create_time),updatedAt:dateTime(detail.post_create_time),language:"zh-CN",durationSeconds:null,thumbnailUrl:null,tags:[],metrics:{likes:null,comments:null,saves:null,shares:null},sourceMetadata:{platform:previous.platform ?? "other",creatorAvatarUrl:previous.iconUrl ?? null,followId:subscription.external_id,knowledgeBaseId,interactionAvailable:false,interactionStatus:"unavailable",hasTranscript:Boolean(detail.post_media_text),transcriptStatus:detail.post_media_text ? "text_only_no_timestamps" : "unavailable",creatorAnalysis:null,provenance:"verified_live"}});
            const persisted=await persistNormalizedContent(admin,{workspaceId,sourceId:source.id,sourceType:"get_notes",syncRunId:runId,raw:{summary,detail,creator:{followId:subscription.external_id,name:subscription.name,platform:previous.platform}},normalized:normalizedItem});normalized+=1;if(persisted.duplicateOfId)duplicates+=1;
            if(persisted.shouldAnalyze)await enqueueGetNotesProcessing(admin,{workspaceId,contentId:persisted.id,contentHash:persisted.contentHash,hasTranscript:Boolean(detail.post_media_text)});
          });
          hasMore=list.hasMore;page+=1;
        }
        const {error:updateError}=await admin.from("source_subscriptions").update({metadata:{...previous,lastContentPublishedAt:latest,lastSyncAt:new Date().toISOString(),lastSyncStatus:"succeeded"}}).eq("id",subscription.id);if(updateError)throw new Error(updateError.message);
      }catch(error){failures.push({creator:subscription.name,error:error instanceof Error?error.message:String(error)});await admin.from("source_subscriptions").update({metadata:{...previous,lastSyncAt:new Date().toISOString(),lastSyncStatus:"failed",lastSyncError:error instanceof Error?error.message.slice(0,300):String(error).slice(0,300)}}).eq("id",subscription.id);}finally{processedBloggers+=1;await progress({phase:"get_notes_bloggers",currentBlogger:subscription.name,processedBloggers,totalBloggers:ordered.length,discoveredContent:fetched,detailReads,rateLimitCount});}
    }
    await admin.from("sources").update({metadata:{...source.metadata,resumeSubscriptionId:failures.length?ordered.find(item=>item.name===failures[0].creator)?.id??null:null,lastWorkerSyncAt:new Date().toISOString()}}).eq("id",source.id);const crossSource=await clusterCrossSourceTopics(admin,workspaceId);await finishSyncRun(admin,{runId,sourceId:source.id,fetched,normalized,errors:failures.length,metrics:{bloggerCount,detailReads,duplicates,rateLimitCount,failures,crossSource}});const brief=await ensureDailyBrief(admin,workspaceId,todayInBeijing());
    return{source:"get_notes" as const,status:failures.length?"partial_success" as const:"verified_live" as const,bloggerCount,fetched,detailReads,normalized,duplicates,rateLimitCount,failures,crossSource,brief};
  }catch(error){await finishSyncRun(admin,{runId,sourceId:source.id,fetched,normalized,errors:failures.length+1,error:error instanceof Error?error.message:String(error),metrics:{bloggerCount,detailReads,duplicates,failures}});throw error;}
}
