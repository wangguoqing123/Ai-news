import { randomUUID } from "node:crypto";
import pg from "pg";
import { CodexCliProvider } from "../lib/ai/codex-cli-provider";
import { getAIProvider,setWorkerAIProviderFactory } from "../lib/ai/runtime";
import { ensureDailyBrief } from "../lib/daily-brief/generate";
import {
  heartbeatIntervalMs,
  isBlockedJobResult,
  nextJobStatus,
  nextRetryAt,
  RetryableJobError,
  type BlockedJobResult,
  type JobType,
} from "../lib/jobs";
import { getSupabaseAdmin } from "../lib/server/supabase-admin";
import { syncAIHot } from "../lib/services/aihot-sync";
import { analyzeCreatorContent,analyzeCrossSource,analyzeEvent } from "../lib/services/analysis";
import { syncGetNotesApi } from "../lib/services/get-notes-api-sync";
import { classifyContentMetadata,translateContentMetadata } from "../lib/services/metadata-processing";
import { enqueueDeepAnalysis,enqueueFinalizeProcessing,enqueueTranscriptTranslation,failProcessingRequest,finalizeProcessingRequest,markProcessingStage } from "../lib/services/processing-requests";
import { translateTranscript } from "../lib/services/transcript-translation";
import { fetchAndPersistTranscript } from "../lib/services/transcripts";
import { syncYouTubeChannels,syncYouTubeChannelVideos } from "../lib/services/youtube-sync";
import { syncGetNotesCli } from "../lib/workers/get-notes-cli";
import { checkWorkerDependencies,dependencyIsHealthy,type WorkerDependencyHealth } from "../lib/workers/health";

process.env.WORKER_RUNTIME="true";
if(process.env.AI_PROVIDER==="codex_cli")setWorkerAIProviderFactory(()=>new CodexCliProvider());

const { Pool }=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl)throw new Error("DATABASE_URL is required for the job worker");

const pool=new Pool({
  connectionString:databaseUrl,
  max:Number(process.env.WORKER_DB_POOL_SIZE??5),
  ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false},
});
const admin=getSupabaseAdmin();
const workerId=`${process.env.WORKER_NAME??"signal-worker"}-${randomUUID().slice(0,8)}`;
const pollMs=Number(process.env.WORKER_POLL_MS??2000);
const leaseMs=Number(process.env.WORKER_LEASE_MS??300_000);
const heartbeatMs=heartbeatIntervalMs(leaseMs);

type ClaimedJob={
  id:string;
  workspace_id:string;
  type:JobType;
  payload:Record<string,unknown>;
  attempt:number;
  max_attempts:number;
};

let activeJob:ClaimedJob|null=null;
let stopping=false;
let shuttingDown=false;
let dependencyHealth:WorkerDependencyHealth|null=null;
let lastHealthCheck=0;
let lastScheduleAt:string|null=null;

async function claimJob():Promise<ClaimedJob|null>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const result=await client.query<ClaimedJob>(`
      select id,workspace_id,type,payload,attempt,max_attempts
      from public.jobs
      where status='queued' and run_at<=now()
      order by priority desc,run_at asc
      for update skip locked
      limit 1
    `);
    const job=result.rows[0];
    if(!job){await client.query("commit");return null;}
    await client.query(`
      update public.jobs
      set status='running',locked_at=now(),locked_by=$2,
          lease_expires_at=now()+($3::text||' milliseconds')::interval,
          heartbeat_at=now(),attempt=attempt+1,blocked_reason=null,
          dependency_type=null,next_retry_at=null
      where id=$1
    `,[job.id,workerId,leaseMs]);
    await client.query(`
      insert into public.job_attempts(workspace_id,job_id,attempt,worker_id,status)
      values($1,$2,$3,$4,'running')
    `,[job.workspace_id,job.id,job.attempt+1,workerId]);
    await client.query("commit");
    return{...job,attempt:job.attempt+1};
  }catch(error){
    await client.query("rollback");
    throw error;
  }finally{
    client.release();
  }
}

function beijingDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date());}

async function reportMetrics(job:ClaimedJob,metrics:Record<string,unknown>){
  await pool.query(`
    update public.jobs
    set metrics=coalesce(metrics,'{}'::jsonb)||$3::jsonb
    where id=$1 and locked_by=$2 and status='running'
  `,[job.id,workerId,JSON.stringify(metrics)]);
  await pool.query(`
    update public.job_attempts
    set metrics=coalesce(metrics,'{}'::jsonb)||$4::jsonb
    where job_id=$1 and attempt=$2 and worker_id=$3 and status='running'
  `,[job.id,job.attempt,workerId,JSON.stringify(metrics)]);
}

async function runJob(job:ClaimedJob):Promise<Record<string,unknown>>{
  const progress=(metrics:Record<string,unknown>)=>reportMetrics(job,metrics);
  const contentId=String(job.payload.contentId??"");const processingRequestId=typeof job.payload.processingRequestId==="string"?job.payload.processingRequestId:null;
  switch(job.type){
    case"sync_aihot":return syncAIHot(admin,job.workspace_id);
    case"sync_youtube_subscriptions":
    case"sync_youtube_channels":return syncYouTubeChannels(admin,job.workspace_id);
    case"sync_youtube_channel":
    case"sync_youtube_channel_videos":return syncYouTubeChannelVideos(admin,job.workspace_id,{},progress);
    case"sync_get_notes":
      return process.env.GET_NOTES_MODE==="api"
        ?syncGetNotesApi(admin,job.workspace_id)
        :process.env.GET_NOTES_MODE==="cli"
          ?syncGetNotesCli(admin,job.workspace_id,{},progress)
          :{status:"webhook_waiting"};
    case"translate_content_metadata":return translateContentMetadata(admin,job.workspace_id,contentId);
    case"classify_content_metadata":return classifyContentMetadata(admin,job.workspace_id,contentId);
    case"analyze_creator_content":
    case"analyze_competitor_content":{
      if(processingRequestId)await markProcessingStage(admin,{workspaceId:job.workspace_id,requestId:processingRequestId,contentId,status:"analyzing",stage:"analyze_creator_content"});
      const result=await analyzeCreatorContent(admin,job.workspace_id,contentId,job.payload);
      if(processingRequestId&&!isBlockedJobResult(result))await enqueueFinalizeProcessing(admin,{workspaceId:job.workspace_id,requestId:processingRequestId,contentId});
      return result;
    }
    case"analyze_event":return analyzeEvent(admin,job.workspace_id,String(job.payload.clusterId??""),job.payload);
    case"analyze_cross_source":return analyzeCrossSource(admin,job.workspace_id,String(job.payload.trendId??""),job.payload);
    case"fetch_transcript":{
      if(processingRequestId)await markProcessingStage(admin,{workspaceId:job.workspace_id,requestId:processingRequestId,contentId,status:"fetching_transcript",stage:"fetch_transcript"});
      const result=await fetchAndPersistTranscript(admin,job.workspace_id,contentId,{processingRequestId:processingRequestId??undefined});
      if(processingRequestId&&!isBlockedJobResult(result)){if(result.status==="ready")await enqueueTranscriptTranslation(admin,{workspaceId:job.workspace_id,requestId:processingRequestId,contentId,transcriptId:result.transcriptId});else await enqueueDeepAnalysis(admin,{workspaceId:job.workspace_id,requestId:processingRequestId,contentId,limited:true,reason:result.reason});}
      return result;
    }
    case"translate_transcript":{
      if(!processingRequestId)throw new Error("字幕翻译任务缺少 processingRequestId");const result=await translateTranscript(admin,{workspaceId:job.workspace_id,contentId,transcriptId:String(job.payload.transcriptId??""),targetLanguage:typeof job.payload.targetLanguage==="string"?job.payload.targetLanguage:"zh-CN"});if(!isBlockedJobResult(result))await enqueueDeepAnalysis(admin,{workspaceId:job.workspace_id,requestId:processingRequestId,contentId});return result;
    }
    case"finalize_processing_request":{if(!processingRequestId)throw new Error("完成任务缺少 processingRequestId");return finalizeProcessingRequest(admin,{workspaceId:job.workspace_id,requestId:processingRequestId,contentId});}
    case"generate_daily_brief":return ensureDailyBrief(admin,job.workspace_id,typeof job.payload.date==="string"?job.payload.date:beijingDate(),{finalize:true});
    case"cleanup_expired_jobs":{
      const result=await pool.query(`
        update public.jobs j
        set status='queued',locked_at=null,locked_by=null,lease_expires_at=null,
            heartbeat_at=null,run_at=now(),error='Worker lease expired; recovered safely'
        where j.status='running'
          and j.lease_expires_at<now()
          and coalesce(j.heartbeat_at,j.locked_at)<now()-interval '2 minutes'
          and not exists(
            select 1 from public.worker_heartbeats w
            where w.worker_id=j.locked_by
              and w.status='active'
              and w.last_seen_at>now()-interval '2 minutes'
          )
        returning j.id
      `);
      return{recovered:result.rowCount??0};
    }
    default:throw new Error(`No handler registered for ${job.type}`);
  }
}

async function completeJob(job:ClaimedJob,result:Record<string,unknown>){
  const transition=await pool.query(`
    update public.jobs
    set status='succeeded',result=$2,locked_at=null,locked_by=null,
        lease_expires_at=null,heartbeat_at=null,error=null,blocked_reason=null,
        dependency_type=null,next_retry_at=null,last_checked_at=now()
    where id=$1 and locked_by=$3 and status='running'
    returning id
  `,[job.id,result,workerId]);
  if(transition.rowCount!==1)return false;
  await pool.query(`
    update public.job_attempts
    set status='succeeded',finished_at=now(),
        metrics=coalesce(metrics,'{}'::jsonb)||$4::jsonb
    where job_id=$1 and attempt=$2 and worker_id=$3 and status='running'
  `,[job.id,job.attempt,workerId,JSON.stringify({result})]);
  return true;
}

async function blockJob(job:ClaimedJob,result:BlockedJobResult){
  const transition=await pool.query(`
    update public.jobs
    set status='blocked',result=$2,blocked_reason=$3,dependency_type=$4,
        next_retry_at=$5,last_checked_at=now(),locked_at=null,locked_by=null,
        lease_expires_at=null,heartbeat_at=null
    where id=$1 and locked_by=$6 and status='running'
    returning id
  `,[job.id,result,result.reason,result.dependencyType,result.nextRetryAt,workerId]);
  if(transition.rowCount!==1)return false;
  await pool.query(`
    update public.job_attempts
    set status='blocked',error=$4,finished_at=now(),
        metrics=coalesce(metrics,'{}'::jsonb)||$5::jsonb
    where job_id=$1 and attempt=$2 and worker_id=$3 and status='running'
  `,[job.id,job.attempt,workerId,result.reason,JSON.stringify({dependencyType:result.dependencyType})]);
  return true;
}

async function failJob(job:ClaimedJob,error:unknown){
  const message=error instanceof Error?error.message:String(error);
  const status=nextJobStatus(job.attempt,job.max_attempts);
  const runAt=error instanceof RetryableJobError?new Date(Date.now()+error.retryAfterMs):nextRetryAt(job.attempt);
  const transition=await pool.query(`
    update public.jobs
    set status=$2,run_at=$3,error=$4,locked_at=null,locked_by=null,
        lease_expires_at=null,heartbeat_at=null,last_checked_at=now()
    where id=$1 and locked_by=$5 and status='running'
    returning id
  `,[job.id,status,runAt,message,workerId]);
  if(transition.rowCount!==1)return false;
  if(error instanceof RetryableJobError&&error.scope==="transcript_pipeline"){
    await pool.query(`
      update public.jobs j
      set run_at=greatest(j.run_at,$2),error=$3
      where j.workspace_id=$1 and j.status='queued'
        and(
          j.type='fetch_transcript'
          or(
            j.type='analyze_creator_content'
            and not exists(
              select 1 from public.transcripts t
              where t.workspace_id=j.workspace_id
                and t.content_id::text=j.payload->>'contentId'
                and t.is_current=true and t.status='ready'
            )
          )
        )
    `,[job.workspace_id,runAt,message]);
  }else if(error instanceof RetryableJobError&&error.scope==="job_type"){
    await pool.query(`
      update public.jobs
      set run_at=greatest(run_at,$2),error=$3
      where workspace_id=$1 and type=$4 and status='queued'
    `,[job.workspace_id,runAt,message,job.type]);
  }
  await pool.query(`
    update public.job_attempts
    set status='failed',error=$4,finished_at=now()
    where job_id=$1 and attempt=$2 and worker_id=$3 and status='running'
  `,[job.id,job.attempt,workerId,message]);
  return true;
}

async function heartbeat(job:ClaimedJob){
  await Promise.all([
    pool.query(`
      update public.jobs
      set lease_expires_at=now()+($3::text||' milliseconds')::interval,
          heartbeat_at=now()
      where id=$1 and locked_by=$2 and status='running'
    `,[job.id,workerId,leaseMs]),
    pool.query(`
      insert into public.worker_heartbeats(worker_id,status,current_job_id,last_seen_at,metadata)
      values($1,'active',$2,now(),$3)
      on conflict(worker_id) do update
      set status='active',current_job_id=excluded.current_job_id,
          last_seen_at=now(),metadata=excluded.metadata
    `,[workerId,job.id,{pid:process.pid,providerHealth:dependencyHealth,lastScheduleAt}]),
  ]);
}

async function withHeartbeat(job:ClaimedJob){
  await heartbeat(job);
  const timer=setInterval(()=>void heartbeat(job).catch(error=>console.error("heartbeat",error instanceof Error?error.message:error)),heartbeatMs);
  try{return await runJob(job);}finally{clearInterval(timer);}
}

let lastScheduleCheck=0;
let lastBlockedCheck=0;
let lastAIRunCleanup=0;
let lastFinalBriefCheck=0;

async function cleanupStaleAIRuns(){
  if(Date.now()-lastAIRunCleanup<60_000)return;
  lastAIRunCleanup=Date.now();
  const staleMs=Math.max(600_000,Number(process.env.AI_RUN_STALE_MS??600_000));
  await pool.query(`
    update public.ai_runs
    set status='failed',error='Worker interrupted before AI run completion'
    where status='running'
      and created_at<now()-($1::text||' milliseconds')::interval
  `,[staleMs]);
}

async function enqueueDueSchedules(){
  if(Date.now()-lastScheduleCheck<30_000)return;
  lastScheduleCheck=Date.now();
  const client=await pool.connect();
  try{
    await client.query("begin");
    const due=await client.query<{id:string;workspace_id:string;job_type:string;payload:Record<string,unknown>}>(`
      select id,workspace_id,job_type,payload
      from public.job_schedules
      where enabled=true and next_run_at<=now()
      for update skip locked
    `);
    for(const schedule of due.rows){
      const date=beijingDate();
      await client.query(`
        insert into public.jobs(workspace_id,type,idempotency_key,payload)
        values($1,$2,$3,$4)
        on conflict(workspace_id,idempotency_key) do nothing
      `,[schedule.workspace_id,schedule.job_type,`schedule:${schedule.id}:${date}`,schedule.payload]);
      await client.query(`
        update public.job_schedules
        set last_enqueued_at=now(),next_run_at=next_run_at+interval '1 day'
        where id=$1
      `,[schedule.id]);
      lastScheduleAt=new Date().toISOString();
    }
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    throw error;
  }finally{
    client.release();
  }
}

async function catchUpMissedSchedules(){
  const client=await pool.connect();try{await client.query("begin");const due=await client.query<{id:string;workspace_id:string;job_type:string;payload:Record<string,unknown>;next_run_at:Date}>(`
    select id,workspace_id,job_type,payload,next_run_at from public.job_schedules
    where enabled=true and next_run_at<=now() and next_run_at>=now()-interval '24 hours'
    for update skip locked
  `);for(const schedule of due.rows){const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(schedule.next_run_at);await client.query(`insert into public.jobs(workspace_id,type,idempotency_key,payload,priority) values($1,$2,$3,$4,180) on conflict(workspace_id,idempotency_key) do nothing`,[schedule.workspace_id,schedule.job_type,`catchup:${schedule.id}:${date}`,{...schedule.payload,catchUp:true,scheduledFor:schedule.next_run_at.toISOString()}]);await client.query(`update public.job_schedules set last_enqueued_at=now(),next_run_at=next_run_at+interval '1 day' where id=$1`,[schedule.id]);lastScheduleAt=new Date().toISOString();}await client.query("commit");}catch(error){await client.query("rollback");throw error;}finally{client.release();}
}

async function ensureSevenAmFinalBrief(){
  if(Date.now()-lastFinalBriefCheck<60_000)return;lastFinalBriefCheck=Date.now();const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Shanghai",hour:"2-digit",hour12:false}).formatToParts(new Date());const hour=Number(parts.find(item=>item.type==="hour")?.value??0);if(hour<7)return;const date=beijingDate();await pool.query(`
    insert into public.jobs(workspace_id,type,idempotency_key,payload,priority)
    select w.id,'generate_daily_brief','daily-final-catchup:'||$1,jsonb_build_object('date',$1,'catchUp',true),220
    from public.workspaces w
    where not exists(select 1 from public.daily_briefs b where b.workspace_id=w.id and b.brief_date=$1::date and b.status='final')
    on conflict(workspace_id,idempotency_key) do nothing
  `,[date]);
}

async function refreshDependencyHealth(force=false){if(!force&&Date.now()-lastHealthCheck<300_000)return;lastHealthCheck=Date.now();dependencyHealth=await checkWorkerDependencies({databaseCheck:async()=>{await pool.query("select 1")},provider:getAIProvider()});}

async function resumeConfiguredBlocked(){
  if(Date.now()-lastBlockedCheck<60_000)return;
  lastBlockedCheck=Date.now();
  await refreshDependencyHealth();const dependencies=[];
  if(dependencyHealth&&dependencyIsHealthy(dependencyHealth,"ai_provider"))dependencies.push("ai_provider");
  if(dependencyHealth&&dependencyIsHealthy(dependencyHealth,"transcript_provider"))dependencies.push("transcript_provider");
  if(dependencies.length){
    await pool.query(`
      update public.jobs
      set status='queued',run_at=now(),blocked_reason=null,dependency_type=null,
          next_retry_at=null,attempt=0
      where status='blocked'
        and dependency_type=any($1::text[])
        and coalesce(next_retry_at,now())<=now()
    `,[dependencies]);
  }
  await pool.query(`
    update public.jobs j
    set status='queued',run_at=now(),blocked_reason=null,dependency_type=null,
        next_retry_at=null,attempt=0
    where j.status='blocked'
      and j.dependency_type='content_profile'
      and exists(
        select 1 from public.content_profiles p
        where p.workspace_id=j.workspace_id and p.is_active=true
      )
  `);
  await pool.query(`
    update public.jobs j set status='queued',run_at=now(),blocked_reason=null,dependency_type=null,next_retry_at=null,attempt=0
    where j.status='blocked' and j.dependency_type='metadata_translation'
      and exists(select 1 from public.content_translations t where t.content_id::text=j.payload->>'contentId' and t.is_current=true and t.status in ('ready','skipped','failed'))
  `);
}

async function loop(){
  await refreshDependencyHealth(true);
  await catchUpMissedSchedules();
  await pool.query(`
    insert into public.worker_heartbeats(worker_id,status,last_seen_at,metadata)
    values($1,'active',now(),$2)
    on conflict(worker_id) do update
    set status='active',last_seen_at=now(),metadata=excluded.metadata
  `,[workerId,{pid:process.pid,providerHealth:dependencyHealth,lastScheduleAt}]);
  while(!stopping){
    await cleanupStaleAIRuns();
    await enqueueDueSchedules();
    await ensureSevenAmFinalBrief();
    await resumeConfiguredBlocked();
    const job=await claimJob();
    if(!job){
      await pool.query(`update public.worker_heartbeats set last_seen_at=now(),current_job_id=null,metadata=$2 where worker_id=$1`,[workerId,{pid:process.pid,providerHealth:dependencyHealth,lastScheduleAt}]);
      await new Promise(resolve=>setTimeout(resolve,pollMs));
      continue;
    }
    activeJob=job;
    try{
      const result=await withHeartbeat(job);
      const transitioned=isBlockedJobResult(result)?await blockJob(job,result):await completeJob(job,result);
      if(!transitioned)console.warn(`Job ${job.id} terminal write skipped because ownership was lost`);
    }catch(error){
      const transitioned=await failJob(job,error);
      if(!transitioned)console.warn(`Job ${job.id} failure write skipped because ownership was lost`);
      const requestId=typeof job.payload.processingRequestId==="string"?job.payload.processingRequestId:null;if(transitioned&&requestId&&nextJobStatus(job.attempt,job.max_attempts)==="dead_letter")await failProcessingRequest(admin,{workspaceId:job.workspace_id,contentId:String(job.payload.contentId??""),requestId,error:error instanceof Error?error.message:String(error)});
    }finally{
      activeJob=null;
    }
  }
}

const shutdown=async()=>{
  if(shuttingDown)return;
  shuttingDown=true;stopping=true;
  const deadline=Date.now()+Number(process.env.WORKER_SHUTDOWN_GRACE_MS??330_000);
  while(activeJob&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
  if(activeJob){
    await pool.query(`
      update public.jobs
      set status='queued',run_at=now(),locked_at=null,locked_by=null,
          lease_expires_at=null,heartbeat_at=null,
          error='Worker stopped during execution; queued for recovery'
      where id=$1 and locked_by=$2 and status='running'
    `,[activeJob.id,workerId]).catch(()=>undefined);
  }
  await pool.query(`
    update public.worker_heartbeats
    set status='stopping',current_job_id=null,last_seen_at=now()
    where worker_id=$1
  `,[workerId]).catch(()=>undefined);
  await pool.end();
};

process.on("SIGTERM",()=>void shutdown());
process.on("SIGINT",()=>void shutdown());
loop().catch(async error=>{
  console.error(error instanceof Error?error.message:error);
  await shutdown();
  process.exitCode=1;
});
