import type { SupabaseClient } from "@supabase/supabase-js";
import { ANALYSIS_VERSION,CREATOR_PROMPT_VERSION,EVENT_PROMPT_VERSION,TREND_PROMPT_VERSION,analysisJobKey,contentAnalysisInputHash } from "../analysis/config";
import { sha256 } from "../dedupe";
import { enqueueJob } from "./ingest";

function record(value:unknown):Record<string,unknown>{return value&&typeof value==="object"?value as Record<string,unknown>:{};}

export async function activeProfileVersion(admin:SupabaseClient,workspaceId:string){
  const{data,error}=await admin.from("content_profiles").select("version").eq("workspace_id",workspaceId).eq("is_active",true).order("version",{ascending:false}).limit(1).maybeSingle();
  if(error)throw new Error(error.message);return data?.version??0;
}

export async function enqueueContentAnalysis(admin:SupabaseClient,input:{workspaceId:string;contentId:string;type?:"analyze_creator_content"|"analyze_competitor_content";contentHash?:string|null;priority?:number;requeueExisting?:boolean;supersedePending?:boolean}){
  const [{data:content,error:contentError},{data:transcript,error:transcriptError},profileVersion]=await Promise.all([
    admin.from("content_items").select("title,summary,body,author,duration_seconds,analysis_input_hash,metadata,source:sources(type,name)").eq("workspace_id",input.workspaceId).eq("id",input.contentId).single(),
    admin.from("transcripts").select("input_hash").eq("workspace_id",input.workspaceId).eq("content_id",input.contentId).eq("is_current",true).eq("status","ready").maybeSingle(),
    activeProfileVersion(admin,input.workspaceId),
  ]);
  if(contentError||!content)throw new Error(contentError?.message??"内容不存在");if(transcriptError&&transcriptError.code!=="42P01")throw new Error(transcriptError.message);
  const derivedContentHash=sha256(JSON.stringify({title:content.title,summary:content.summary,body:content.body,author:content.author,durationSeconds:content.duration_seconds,source:content.source}));const baseHash=input.contentHash??content.analysis_input_hash??(typeof record(content.metadata).analysisInputHash==="string"?String(record(content.metadata).analysisInputHash):derivedContentHash);if(!content.analysis_input_hash){const backfill=await admin.from("content_items").update({analysis_input_hash:baseHash}).eq("id",input.contentId).is("analysis_input_hash",null);if(backfill.error)throw new Error(backfill.error.message);}
  const canonicalHash=contentAnalysisInputHash({contentHash:baseHash,transcriptHash:transcript?.input_hash});const inputHash=input.requeueExisting?sha256(`${canonicalHash}:rerun:${Math.floor(Date.now()/300_000)}`):canonicalHash;const type=input.type??"analyze_creator_content";
  if(input.requeueExisting||input.supersedePending){const superseded=await admin.from("jobs").update({status:"cancelled",result:{reason:"superseded_by_new_analysis_input",inputHash},locked_at:null,locked_by:null,lease_expires_at:null,heartbeat_at:null}).eq("workspace_id",input.workspaceId).eq("type",type).in("status",["queued","blocked"]).contains("payload",{contentId:input.contentId});if(superseded.error)throw new Error(superseded.error.message);}
  const identity={entityType:"content" as const,entityId:input.contentId,inputHash,promptVersion:CREATOR_PROMPT_VERSION,profileVersion,analysisVersion:ANALYSIS_VERSION};
  return enqueueJob(admin,{workspaceId:input.workspaceId,type,idempotencyKey:analysisJobKey(type,identity),payload:{contentId:input.contentId,contentHash:baseHash,inputHash,promptVersion:CREATOR_PROMPT_VERSION,profileVersion,analysisVersion:ANALYSIS_VERSION},priority:input.priority??60,requeueExisting:input.requeueExisting});
}

export async function enqueueEventAnalysis(admin:SupabaseClient,input:{workspaceId:string;clusterId:string;inputHash:string;priority?:number;requeueExisting?:boolean}){
  const profileVersion=await activeProfileVersion(admin,input.workspaceId);const type="analyze_event";const inputHash=input.requeueExisting?sha256(`${input.inputHash}:rerun:${Math.floor(Date.now()/300_000)}`):input.inputHash;const identity={entityType:"event" as const,entityId:input.clusterId,inputHash,promptVersion:EVENT_PROMPT_VERSION,profileVersion,analysisVersion:ANALYSIS_VERSION};
  return enqueueJob(admin,{workspaceId:input.workspaceId,type,idempotencyKey:analysisJobKey(type,identity),payload:{clusterId:input.clusterId,inputHash,promptVersion:EVENT_PROMPT_VERSION,profileVersion,analysisVersion:ANALYSIS_VERSION},priority:input.priority??80,requeueExisting:input.requeueExisting});
}

export async function enqueueTrendAnalysis(admin:SupabaseClient,input:{workspaceId:string;trendId:string;inputHash:string;priority?:number;requeueExisting?:boolean}){
  const profileVersion=await activeProfileVersion(admin,input.workspaceId);const type="analyze_cross_source";const identity={entityType:"trend" as const,entityId:input.trendId,inputHash:input.inputHash,promptVersion:TREND_PROMPT_VERSION,profileVersion,analysisVersion:ANALYSIS_VERSION};
  return enqueueJob(admin,{workspaceId:input.workspaceId,type,idempotencyKey:analysisJobKey(type,identity),payload:{trendId:input.trendId,inputHash:input.inputHash,promptVersion:TREND_PROMPT_VERSION,profileVersion,analysisVersion:ANALYSIS_VERSION},priority:input.priority??50,requeueExisting:input.requeueExisting});
}

export function clusterInputHash(ids:string[]){return sha256([...ids].sort().join(":"));}

export async function requeueAnalysis(admin:SupabaseClient,input:{workspaceId:string;contentId?:string;clusterId?:string;status?:string;days?:number;allPending?:boolean;allBlocked?:boolean}){
  const jobs:Array<Record<string,unknown>>=[];
  if(input.allBlocked||input.status==="blocked"){
    const{data,error}=await admin.from("jobs").update({status:"queued",run_at:new Date().toISOString(),blocked_reason:null,dependency_type:null,next_retry_at:null,last_checked_at:new Date().toISOString(),attempt:0,error:null}).eq("workspace_id",input.workspaceId).eq("status","blocked").select("id,type,status");if(error)throw new Error(error.message);jobs.push(...(data??[]));
  }
  if(input.clusterId){const{data,error}=await admin.from("event_clusters").select("analysis_input_hash").eq("workspace_id",input.workspaceId).eq("id",input.clusterId).single();if(error||!data)throw new Error(error?.message??"事件不存在");jobs.push(await enqueueEventAnalysis(admin,{workspaceId:input.workspaceId,clusterId:input.clusterId,inputHash:data.analysis_input_hash??"legacy",requeueExisting:true}));}
  let ids:string[]=[];
  if(input.contentId)ids=[input.contentId];
  else if(input.allPending||input.days||input.status==="pending"){
    let query=admin.from("content_items").select("id").eq("workspace_id",input.workspaceId).is("duplicate_of_id",null);
    if(input.allPending||input.status==="pending")query=query.eq("processing_status","pending");
    if(input.days)query=query.gte("published_at",new Date(Date.now()-input.days*86_400_000).toISOString());
    const{data,error}=await query.limit(5000);if(error)throw new Error(error.message);ids=(data??[]).map(item=>item.id);
  }
  for(const contentId of ids)jobs.push(await enqueueContentAnalysis(admin,{workspaceId:input.workspaceId,contentId,requeueExisting:true}));
  return{jobs,requested:jobs.length};
}
