import pg from "pg";
import { randomUUID } from "node:crypto";
import { analyzeCreatorContent,analyzeEvent } from "../lib/services/analysis";
import { syncAIHot } from "../lib/services/aihot-sync";
import { ensureDailyBrief } from "../lib/daily-brief/generate";
import { syncGetNotesApi } from "../lib/services/get-notes-api-sync";
import { syncGetNotesCli } from "../lib/workers/get-notes-cli";
import { syncYouTubeChannels,syncYouTubeChannelVideos } from "../lib/services/youtube-sync";
import { nextJobStatus,nextRetryAt,type JobType } from "../lib/jobs";
import { getSupabaseAdmin } from "../lib/server/supabase-admin";

const { Pool }=pg;const databaseUrl=process.env.DATABASE_URL;if(!databaseUrl)throw new Error("DATABASE_URL is required for the job worker");
const pool=new Pool({connectionString:databaseUrl,max:Number(process.env.WORKER_DB_POOL_SIZE??5),ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
const admin=getSupabaseAdmin();const workerId=`${process.env.WORKER_NAME??"signal-worker"}-${randomUUID().slice(0,8)}`;const pollMs=Number(process.env.WORKER_POLL_MS??2000);
type ClaimedJob={id:string;workspace_id:string;type:JobType;payload:Record<string,unknown>;attempt:number;max_attempts:number};

async function claimJob():Promise<ClaimedJob|null>{const client=await pool.connect();try{await client.query("begin");const result=await client.query<ClaimedJob>(`select id,workspace_id,type,payload,attempt,max_attempts from public.jobs where status='queued' and run_at<=now() order by priority desc,run_at asc for update skip locked limit 1`);const job=result.rows[0];if(!job){await client.query("commit");return null}await client.query(`update public.jobs set status='running',locked_at=now(),locked_by=$2,lease_expires_at=now()+interval '5 minutes',attempt=attempt+1 where id=$1`,[job.id,workerId]);await client.query(`insert into public.job_attempts(workspace_id,job_id,attempt,worker_id,status) values($1,$2,$3,$4,'running')`,[job.workspace_id,job.id,job.attempt+1,workerId]);await client.query("commit");return{...job,attempt:job.attempt+1}}catch(error){await client.query("rollback");throw error}finally{client.release()}}

function beijingDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date())}

async function markTranscriptUnavailable(job:ClaimedJob){const contentId=String(job.payload.contentId??"");if(!contentId)throw new Error("fetch_transcript 缺少 contentId");const{data,error}=await admin.from("content_items").select("metadata").eq("id",contentId).single();if(error)throw new Error(error.message);const metadata=data.metadata&&typeof data.metadata==="object"?data.metadata as Record<string,unknown>:{};const result=await admin.from("content_items").update({metadata:{...metadata,hasTranscript:false,transcriptStatus:"unavailable_official_api"}}).eq("id",contentId);if(result.error)throw new Error(result.error.message);return{status:"unavailable",reason:"YouTube 官方只读 API 不提供公开视频字幕"}}

async function runJob(job:ClaimedJob):Promise<Record<string,unknown>>{
  switch(job.type){
    case"sync_aihot":return syncAIHot(admin,job.workspace_id);
    case"sync_youtube_subscriptions":case"sync_youtube_channels":return syncYouTubeChannels(admin,job.workspace_id);
    case"sync_youtube_channel":case"sync_youtube_channel_videos":return syncYouTubeChannelVideos(admin,job.workspace_id);
    case"sync_get_notes":return process.env.GET_NOTES_MODE==="api"?syncGetNotesApi(admin,job.workspace_id):process.env.GET_NOTES_MODE==="cli"?syncGetNotesCli(admin,job.workspace_id):{status:"webhook_waiting"};
    case"analyze_creator_content":case"analyze_competitor_content":return analyzeCreatorContent(admin,job.workspace_id,String(job.payload.contentId??""));
    case"analyze_event":return analyzeEvent(admin,job.workspace_id,String(job.payload.clusterId??""));
    case"fetch_transcript":return markTranscriptUnavailable(job);
    case"generate_daily_brief":return ensureDailyBrief(admin,job.workspace_id,typeof job.payload.date==="string"?job.payload.date:beijingDate(),{force:true});
    case"cleanup_expired_jobs":{const result=await pool.query(`update public.jobs set status='queued',locked_at=null,locked_by=null,lease_expires_at=null where status='running' and lease_expires_at<now() returning id`);return{recovered:result.rowCount??0}}
    default:throw new Error(`No handler registered for ${job.type}`);
  }
}

async function completeJob(job:ClaimedJob,result:Record<string,unknown>){await pool.query(`update public.jobs set status='succeeded',result=$2,locked_at=null,locked_by=null,lease_expires_at=null,error=null where id=$1`,[job.id,result]);await pool.query(`update public.job_attempts set status='succeeded',finished_at=now(),metrics=$3 where job_id=$1 and attempt=$2`,[job.id,job.attempt,{result}])}
async function failJob(job:ClaimedJob,error:unknown){const message=error instanceof Error?error.message:String(error);const status=nextJobStatus(job.attempt,job.max_attempts);const runAt=nextRetryAt(job.attempt);await pool.query(`update public.jobs set status=$2,run_at=$3,error=$4,locked_at=null,locked_by=null,lease_expires_at=null where id=$1`,[job.id,status,runAt,message]);await pool.query(`update public.job_attempts set status='failed',error=$3,finished_at=now() where job_id=$1 and attempt=$2`,[job.id,job.attempt,message])}

let lastScheduleCheck=0;
async function enqueueDueSchedules(){if(Date.now()-lastScheduleCheck<30_000)return;lastScheduleCheck=Date.now();const client=await pool.connect();try{await client.query("begin");const due=await client.query<{id:string;workspace_id:string;job_type:string;payload:Record<string,unknown>}>(`select id,workspace_id,job_type,payload from public.job_schedules where enabled=true and next_run_at<=now() for update skip locked`);for(const schedule of due.rows){const date=beijingDate();await client.query(`insert into public.jobs(workspace_id,type,idempotency_key,payload) values($1,$2,$3,$4) on conflict(workspace_id,idempotency_key) do nothing`,[schedule.workspace_id,schedule.job_type,`schedule:${schedule.id}:${date}`,schedule.payload]);await client.query(`update public.job_schedules set last_enqueued_at=now(),next_run_at=next_run_at+interval '1 day' where id=$1`,[schedule.id])}await client.query("commit")}catch(error){await client.query("rollback");throw error}finally{client.release()}}

async function loop(){while(true){await enqueueDueSchedules();const job=await claimJob();if(!job){await new Promise((resolve)=>setTimeout(resolve,pollMs));continue}try{await completeJob(job,await runJob(job))}catch(error){await failJob(job,error)}}}
const shutdown=async()=>{await pool.end();process.exit(0)};process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);loop().catch(async(error)=>{console.error(error instanceof Error?error.message:error);await pool.end();process.exit(1)});
