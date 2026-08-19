import { getSupabaseAdmin } from "../lib/server/supabase-admin";

const admin=getSupabaseAdmin();
const[heartbeats,jobs,analyses,transcripts]=await Promise.all([
  admin.from("worker_heartbeats").select("worker_id,status,current_job_id,last_seen_at").order("last_seen_at",{ascending:false}).limit(5),
  admin.from("jobs").select("status,type"),
  admin.from("ai_runs").select("status,cost_usd,input_tokens,output_tokens").gte("created_at",new Date(Date.now()-86_400_000).toISOString()),
  admin.from("transcripts").select("status,provider,is_current").gte("created_at",new Date(Date.now()-86_400_000).toISOString()),
]);
for(const result of[heartbeats,jobs,analyses,transcripts])if(result.error)throw new Error(result.error.message);
const count=(rows:Array<Record<string,unknown>>,key:string)=>rows.reduce<Record<string,number>>((output,row)=>{const value=String(row[key]??"unknown");output[value]=(output[value]??0)+1;return output;},{});
console.log(JSON.stringify({
  heartbeats:heartbeats.data??[],
  jobs:count((jobs.data??[])as Array<Record<string,unknown>>,"status"),
  analyses:count((analyses.data??[])as Array<Record<string,unknown>>,"status"),
  transcripts:count((transcripts.data??[])as Array<Record<string,unknown>>,"status"),
  spendUsd:(analyses.data??[]).reduce((sum,row)=>sum+Number(row.cost_usd??0),0),
},null,2));
