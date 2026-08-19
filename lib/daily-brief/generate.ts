import type{SupabaseClient}from"@supabase/supabase-js";
import type{DailyBriefEntry}from"../domain/signal-desk";
import{enqueueJob}from"../services/ingest";

function range(date:string){
  const start=new Date(`${date}T00:00:00+08:00`);
  return{
    start:start.toISOString(),
    end:new Date(start.getTime()+86_400_000).toISOString(),
    finalBoundary:new Date(`${date}T06:40:00+08:00`),
  };
}

export function buildDailyBriefEntries(input:{
  events:Array<{id:string;title:string;summary:string|null}>;
  trend?:{id:string;title:string;summary:string|null}|null;
  creator?:{id:string;title:string;summary:string|null}|null;
  topic?:{id:string;topic:string;differentiated_angle:string|null}|null;
}){
  const entries:DailyBriefEntry[]=input.events.slice(0,2).map((item,index)=>({
    id:`event-${item.id}`,kind:"event",label:index===0?"今天最重要的是":"还值得关注",
    title:item.title,description:item.summary,href:`/ai-news?event=${item.id}`,
  }));
  if(input.trend)entries.push({id:`trend-${input.trend.id}`,kind:"trend",label:"跨来源变化",title:input.trend.title,description:input.trend.summary,href:`/ai-news?trend=${input.trend.id}`});
  if(input.creator)entries.push({id:`creator-${input.creator.id}`,kind:"creator",label:"今天最值得投入时间",title:input.creator.title,description:input.creator.summary,href:`/learning/${input.creator.id}`});
  if(input.topic)entries.push({id:`topic-${input.topic.id}`,kind:"topic",label:"今天最值得考虑的选题",title:input.topic.topic,description:input.topic.differentiated_angle,href:`/learning?topic=${input.topic.id}`});
  return entries.slice(0,5);
}

const coreJobTypes=["sync_aihot","sync_youtube_channel_videos","sync_get_notes","translate_content_metadata","classify_content_metadata","analyze_event"];

export function dailyBriefStatus(input:{allSourcesReady:boolean;pendingTaskCount:number;timedOut:boolean;finalize?:boolean}){
  return input.allSourcesReady&&input.pendingTaskCount===0||input.finalize===true&&input.timedOut?"final"as const:"provisional"as const;
}

export async function dailyBriefReadiness(admin:SupabaseClient,workspaceId:string,date:string){
  const{start,end,finalBoundary}=range(date);
  const[pendingResult,sourcesResult]=await Promise.all([
    admin.from("jobs").select("id",{count:"exact",head:true}).eq("workspace_id",workspaceId).in("type",coreJobTypes).in("status",["queued","running","blocked"]).gte("created_at",start).lt("created_at",end),
    admin.from("sources").select("type,last_success_at").eq("workspace_id",workspaceId).eq("status","active").in("type",["aihot","youtube","get_notes"]),
  ]);
  if(pendingResult.error)throw new Error(pendingResult.error.message);
  if(sourcesResult.error)throw new Error(sourcesResult.error.message);
  const sources=sourcesResult.data??[];
  const readySources=sources.filter(item=>item.last_success_at&&item.last_success_at>=start&&item.last_success_at<end).map(item=>item.type);
  const requiredSources=[...new Set(sources.map(item=>item.type))];
  return{
    pendingTaskCount:pendingResult.count??0,
    requiredSources,readySources,
    allSourcesReady:requiredSources.length>0&&requiredSources.every(type=>readySources.includes(type)),
    timedOut:Date.now()>=finalBoundary.getTime(),
    finalBoundary:finalBoundary.toISOString(),
  };
}

export async function ensureDailyBrief(admin:SupabaseClient,workspaceId:string,date:string,options:{finalize?:boolean}={}){
  const{data:existing,error:existingError}=await admin.from("daily_briefs").select("id,status").eq("workspace_id",workspaceId).eq("brief_date",date).maybeSingle();
  if(existingError)throw new Error(existingError.message);
  if(existing?.status==="final")return{id:existing.id,created:false,status:"final"as const};
  const readiness=await dailyBriefReadiness(admin,workspaceId,date);
  const status=dailyBriefStatus({...readiness,finalize:options.finalize});
  const{start,end}=range(date);
  const[eventsResult,creatorsResult,topicsResult,trendsResult]=await Promise.all([
    admin.from("event_clusters").select("id,title,summary,importance,topics").eq("workspace_id",workspaceId).gte("last_seen_at",start).lt("last_seen_at",end).eq("status","active").order("importance",{ascending:false}).limit(3),
    admin.from("content_items").select("id,title,summary,learning_score,metadata,source:sources!inner(type)").eq("workspace_id",workspaceId).in("sources.type",["youtube","get_notes"]).gte("published_at",start).lt("published_at",end).is("duplicate_of_id",null).order("learning_score",{ascending:false,nullsFirst:false}).limit(1),
    admin.from("topic_candidates").select("id,topic,differentiated_angle").eq("workspace_id",workspaceId).gte("created_at",start).lt("created_at",end).neq("status","abandoned").order("created_at",{ascending:false}).limit(1),
    admin.from("trend_clusters").select("id,title,summary,status").eq("workspace_id",workspaceId).in("status",["rising","emerging"]).order("evidence_count",{ascending:false}).limit(1),
  ]);
  for(const result of[eventsResult,creatorsResult,topicsResult,trendsResult])if(result.error)throw new Error(result.error.message);
  const eventIds=(eventsResult.data??[]).map(item=>item.id);
  const{data:analyses,error:analysisError}=eventIds.length
    ?await admin.from("event_analyses").select("cluster_id,happened,real_change,why_important").in("cluster_id",eventIds).eq("is_current",true).eq("status","ready")
    :{data:[],error:null};
  if(analysisError)throw new Error(analysisError.message);
  const analysisMap=new Map((analyses??[]).map(item=>[item.cluster_id,item]));
  const editorialEvents=(eventsResult.data??[]).map(item=>{
    const analysis=analysisMap.get(item.id);
    return{...item,summary:analysis?[analysis.happened,analysis.real_change,analysis.why_important].filter(Boolean).join(" "):item.summary};
  });
  const creator=creatorsResult.data?.[0];
  const creatorMetadata=creator?.metadata&&typeof creator.metadata==="object"?creator.metadata as Record<string,unknown>:{};
  const entries=buildDailyBriefEntries({
    events:editorialEvents,
    trend:trendsResult.data?.[0],
    creator:creator?{...creator,title:typeof creatorMetadata.translatedTitle==="string"?creatorMetadata.translatedTitle:creator.title,summary:typeof creatorMetadata.translatedSummary==="string"?creatorMetadata.translatedSummary:creator.summary}:null,
    topic:topicsResult.data?.[0],
  });
  const now=new Date().toISOString();
  const payload={
    workspace_id:workspaceId,brief_date:date,timezone:"Asia/Shanghai",status,
    summary:{entries,generatedFrom:"database",generatedAt:now,pendingTaskCount:readiness.pendingTaskCount,requiredSources:readiness.requiredSources,readySources:readiness.readySources,finalBoundary:readiness.finalBoundary},
    completed_at:status==="final"?now:null,
  };
  const{data,error}=await admin.from("daily_briefs").upsert(payload,{onConflict:"workspace_id,brief_date"}).select("id").single();
  if(error||!data)throw new Error(error?.message??"生成简报失败");
  if(status!=="final"){
    const job=await enqueueJob(admin,{workspaceId,type:"generate_daily_brief",idempotencyKey:`daily-final:${date}`,payload:{date},priority:85,requeueExisting:true});
    const runAt=new Date(Math.max(Date.now(),new Date(readiness.finalBoundary).getTime())).toISOString();
    await admin.from("jobs").update({run_at:runAt}).eq("id",job.id).eq("status","queued");
  }
  return{id:data.id as string,created:true,entries:entries.length,status,pendingTaskCount:readiness.pendingTaskCount};
}
