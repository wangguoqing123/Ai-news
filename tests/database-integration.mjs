import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";

const {Client}=pg;
const container=`signal-desk-db-test-${process.pid}`;
const docker=(args,options={})=>execFileSync("docker",args,{encoding:"utf8",maxBuffer:20*1024*1024,...options}).trim();
const psql=(sql)=>docker(["exec","-i",container,"psql","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-q"],{input:sql});
const v1=fs.readFileSync(new URL("../supabase/migrations/202608170001_signal_desk.sql",import.meta.url),"utf8");
const v2=fs.readFileSync(new URL("../supabase/migrations/202608170002_signal_desk_v2.sql",import.meta.url),"utf8");
const v3=fs.readFileSync(new URL("../supabase/migrations/202608170003_signal_desk_reliable_daily.sql",import.meta.url),"utf8");
const v4=fs.readFileSync(new URL("../supabase/migrations/202608180001_signal_desk_concurrency.sql",import.meta.url),"utf8");
const v5=fs.readFileSync(new URL("../supabase/migrations/202608180002_signal_desk_migration_audit.sql",import.meta.url),"utf8");
const v6=fs.readFileSync(new URL("../supabase/migrations/202608180003_signal_desk_transcript_idempotency.sql",import.meta.url),"utf8");
const v7=fs.readFileSync(new URL("../supabase/migrations/202608180004_signal_desk_activation_order.sql",import.meta.url),"utf8");
const userOne="11111111-1111-4111-8111-111111111111";
const userTwo="22222222-2222-4222-8222-222222222222";
let client;

try {
  docker(["run","--rm","-d","--name",container,"-e","POSTGRES_PASSWORD=postgres","-p","127.0.0.1::5432","pgvector/pgvector:pg16"]);
  for(let attempt=0;attempt<60;attempt+=1){try{const logs=docker(["logs",container]);if(logs.includes("PostgreSQL init process complete")){docker(["exec",container,"pg_isready","-U","postgres"]);break}}catch{ /* Initialization is still in progress. */ }if(attempt===59)throw new Error("PostgreSQL test container did not become ready");await new Promise((resolve)=>setTimeout(resolve,500));}
  psql(`create role anon noinherit; create role authenticated noinherit; create role service_role noinherit bypassrls; create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'); create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,service_role; grant select on auth.users to authenticated,service_role;`);
  psql(v1);
  psql(`insert into auth.users(id,raw_user_meta_data) values ('${userOne}','{"full_name":"Owner One"}'),('${userTwo}','{"full_name":"Owner Two"}');`);
  psql(v2);
  psql(v3);
  psql(v4);
  psql(v5);
  psql(v6);
  psql(v7);
  const port=Number(docker(["port",container,"5432/tcp"]).split(":").at(-1));
  client=new Client({host:"127.0.0.1",port,user:"postgres",password:"postgres",database:"postgres"});await client.connect();
  const workspaces=await client.query("select id,owner_id from workspaces order by owner_id");assert.equal(workspaces.rowCount,2);
  const workspaceOne=workspaces.rows.find((row)=>row.owner_id===userOne).id;const workspaceTwo=workspaces.rows.find((row)=>row.owner_id===userTwo).id;
  assert.equal((await client.query("select count(*)::int as count from job_schedules")).rows[0].count,8);
  assert.equal((await client.query("select count(*)::int as count from signal_desk_migrations")).rows[0].count,6);
  for(const name of ["activate_creator_content_analysis","activate_event_analysis","activate_transcript"]){const definition=(await client.query("select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[name])).rows[0].definition;assert.match(definition,/set is_current=false/i);assert.match(definition,/set is_current=true/i);}
  const activeProfile=(await client.query("select version,identity_text,focus_topics from content_profiles where workspace_id=$1 and is_active=true",[workspaceOne])).rows[0];assert.match(activeProfile.identity_text,/AI 内容创作者/);assert.ok(activeProfile.focus_topics.includes("Claude Code"));
  const source=(await client.query("insert into sources(workspace_id,type,external_id,name) values($1,'aihot','aihot','AIHot') returning id",[workspaceOne])).rows[0];
  const run=(await client.query("insert into sync_runs(workspace_id,source_id,status) values($1,$2,'succeeded') returning id",[workspaceOne,source.id])).rows[0];
  const raw=(await client.query("insert into raw_ingest_records(workspace_id,source_id,sync_run_id,external_id,payload,payload_hash) values($1,$2,$3,'real-1',$4,'hash-1') returning id",[workspaceOne,source.id,run.id,{title:"真实 AIHot 内容",links:{original:"https://example.com/official"}}])).rows[0];
  const content=(await client.query("insert into content_items(workspace_id,source_id,external_id,content_type,title,canonical_url,published_at,raw_record_id) values($1,$2,'real-1','article','真实 AIHot 内容','https://example.com/official',now(),$3) returning id",[workspaceOne,source.id,raw.id])).rows[0];
  const versionSnapshot={input_hash:"input-v1",payload_hash:"hash-1",content_fingerprint:"fingerprint-1",title:"真实 AIHot 内容",summary:null,body:null,source_updated_at:null,analysis_snapshot:null};
  const firstVersion=(await client.query("select (public.record_content_version($1,$2,$3)).id as id",[workspaceOne,content.id,versionSnapshot])).rows[0].id;
  const sameVersion=(await client.query("select (public.record_content_version($1,$2,$3)).id as id",[workspaceOne,content.id,versionSnapshot])).rows[0].id;assert.equal(sameVersion,firstVersion);assert.equal((await client.query("select count(*)::int as count from content_versions where content_id=$1",[content.id])).rows[0].count,1);
  const creatorAnalysisOne=(await client.query("insert into creator_content_analyses(workspace_id,content_id,status,input_hash,content_hash,prompt_version,profile_version,analysis_version,is_current) values($1,$2,'ready','analysis-1','content-1','prompt-1',1,'v1',true) returning id",[workspaceOne,content.id])).rows[0];
  const creatorAnalysisTwo=(await client.query("insert into creator_content_analyses(workspace_id,content_id,status,input_hash,content_hash,prompt_version,profile_version,analysis_version,is_current) values($1,$2,'ready','analysis-2','content-1','prompt-1',1,'v1',false) returning id",[workspaceOne,content.id])).rows[0];
  await client.query("select public.activate_creator_content_analysis($1,$2,$3)",[workspaceOne,content.id,creatorAnalysisTwo.id]);assert.deepEqual((await client.query("select id from creator_content_analyses where content_id=$1 and is_current=true",[content.id])).rows.map(row=>row.id),[creatorAnalysisTwo.id]);
  const eventCluster=(await client.query("insert into event_clusters(workspace_id,title,status) values($1,'并发事件','active') returning id",[workspaceOne])).rows[0];
  const eventAnalysisOne=(await client.query("insert into event_analyses(workspace_id,cluster_id,status,input_hash,prompt_version,profile_version,analysis_version,is_current) values($1,$2,'ready','event-1','prompt-1',1,'v1',true) returning id",[workspaceOne,eventCluster.id])).rows[0];
  const eventAnalysisTwo=(await client.query("insert into event_analyses(workspace_id,cluster_id,status,input_hash,prompt_version,profile_version,analysis_version,is_current) values($1,$2,'ready','event-2','prompt-1',1,'v1',false) returning id",[workspaceOne,eventCluster.id])).rows[0];
  await client.query("select public.activate_event_analysis($1,$2,$3)",[workspaceOne,eventCluster.id,eventAnalysisTwo.id]);assert.deepEqual((await client.query("select id from event_analyses where cluster_id=$1 and is_current=true",[eventCluster.id])).rows.map(row=>row.id),[eventAnalysisTwo.id]);
  const transcriptOne=(await client.query("insert into transcripts(workspace_id,content_id,language,provider,status,is_current) values($1,$2,'en','test','ready',true) returning id",[workspaceOne,content.id])).rows[0];
  const transcriptTwo=(await client.query("insert into transcripts(workspace_id,content_id,language,provider,status,is_current) values($1,$2,'zh','test','ready',false) returning id",[workspaceOne,content.id])).rows[0];
  await client.query("select public.activate_transcript($1,$2,$3)",[workspaceOne,content.id,transcriptTwo.id]);assert.deepEqual((await client.query("select id from transcripts where content_id=$1 and is_current=true",[content.id])).rows.map(row=>row.id),[transcriptTwo.id]);
  await client.query("update transcripts set input_hash='same-transcript-input' where id=$1",[transcriptTwo.id]);
  await assert.rejects(()=>client.query("insert into transcripts(workspace_id,content_id,language,provider,status,input_hash,is_current) values($1,$2,'zh','test','ready','same-transcript-input',false)",[workspaceOne,content.id]),/duplicate key/i);
  await client.query("insert into jobs(workspace_id,type,status,idempotency_key,blocked_reason,dependency_type,next_retry_at) values($1,'analyze_creator_content','blocked','analysis:block','AI Provider 未配置','ai_provider',now()+interval '15 minutes')",[workspaceOne]);
  assert.equal((await client.query("select dependency_type from jobs where idempotency_key='analysis:block'")).rows[0].dependency_type,"ai_provider");
  const ownershipJob=(await client.query("insert into jobs(workspace_id,type,status,idempotency_key,locked_by,locked_at,lease_expires_at,attempt) values($1,'analyze_creator_content','running','ownership:race','worker-b',now(),now()+interval '5 minutes',2) returning id",[workspaceOne])).rows[0];
  await client.query("insert into job_attempts(workspace_id,job_id,attempt,worker_id,status) values($1,$2,1,'worker-a','running'),($1,$2,2,'worker-b','running')",[workspaceOne,ownershipJob.id]);
  const staleTransition=await client.query("update jobs set status='succeeded',locked_by=null where id=$1 and locked_by='worker-a' and status='running' returning id",[ownershipJob.id]);assert.equal(staleTransition.rowCount,0);
  const afterStale=(await client.query("select status,locked_by from jobs where id=$1",[ownershipJob.id])).rows[0];assert.deepEqual(afterStale,{status:"running",locked_by:"worker-b"});
  const ownedTransition=await client.query("update jobs set status='succeeded',locked_by=null where id=$1 and locked_by='worker-b' and status='running' returning id",[ownershipJob.id]);assert.equal(ownedTransition.rowCount,1);
  await client.query("insert into worker_heartbeats(worker_id,status,last_seen_at) values('worker-test','active',now())");assert.equal((await client.query("select count(*)::int as count from worker_heartbeats where status='active'")).rows[0].count,1);
  const persisted=await client.query("select r.payload->>'title' as raw_title,c.title,c.raw_record_id from content_items c join raw_ingest_records r on r.id=c.raw_record_id where c.id=$1",[content.id]);
  assert.equal(persisted.rows[0].raw_title,"真实 AIHot 内容");assert.equal(persisted.rows[0].raw_record_id,raw.id);
  await assert.rejects(()=>client.query("insert into raw_ingest_records(workspace_id,source_id,sync_run_id,external_id,payload,payload_hash) values($1,$2,$3,'real-1','{}','hash-1')",[workspaceOne,source.id,run.id]),/duplicate key/i);
  await client.query("begin");await client.query("set local role authenticated");await client.query("select set_config('request.jwt.claim.sub',$1,true)",[userOne]);
  assert.equal((await client.query("select count(*)::int as count from sources")).rows[0].count,1);
  await client.query("insert into content_user_states(workspace_id,user_id,content_id,is_saved,watch_later,queued_learning) values($1,$2,$3,true,true,true)",[workspaceOne,userOne,content.id]);
  await assert.rejects(()=>client.query("insert into content_user_states(workspace_id,user_id,content_id,is_saved) values($1,$2,$3,true)",[workspaceTwo,userOne,content.id]),/row-level security/i);
  await client.query("rollback");
  const state=(await client.query("select is_saved,watch_later,queued_learning from content_user_states where content_id=$1",[content.id])).rows[0];assert.equal(state,undefined,"rolled back state should not persist");
  await client.query("insert into content_user_states(workspace_id,user_id,content_id,is_saved,watch_later,queued_learning) values($1,$2,$3,true,true,true)",[workspaceOne,userOne,content.id]);
  const topic=(await client.query("insert into topic_candidates(workspace_id,topic,status,creation_source) values($1,'基于真实证据的选题','candidate','manual_from_real_evidence') returning id",[workspaceOne])).rows[0];
  await client.query("insert into topic_sources(workspace_id,topic_id,source_type,source_id,purpose,excerpt) values($1,$2,'content',$3,'evidence','真实 AIHot 内容')",[workspaceOne,topic.id,content.id]);
  assert.equal((await client.query("select count(*)::int as count from topic_sources where topic_id=$1 and source_id=$2",[topic.id,content.id])).rows[0].count,1);
  await client.query("insert into daily_briefs(workspace_id,brief_date,timezone,status,summary,completed_at) values($1,current_date,'Asia/Shanghai','ready',$2,now())",[workspaceOne,{entries:[{kind:"event",sourceId:content.id}]}]);
  assert.equal((await client.query("select summary->'entries'->0->>'sourceId' as source_id from daily_briefs where workspace_id=$1",[workspaceOne])).rows[0].source_id,content.id);
  const profilePayload={identity_text:"新版身份",content_direction:"新版方向",target_audience:"新版受众",formats:["图文"],focus_topics:["AI 编程"],excluded_topics:[],products:"产品",value_criteria:{text:"真实证据"},forbidden_content:[],historical_topics:[]};await client.query("select public.create_content_profile_version($1,$2)",[workspaceOne,profilePayload]);await client.query("select public.create_content_profile_version($1,$2)",[workspaceOne,{...profilePayload,identity_text:"最新身份"}]);const currentProfiles=await client.query("select version,identity_text from content_profiles where workspace_id=$1 and is_active=true",[workspaceOne]);assert.deepEqual(currentProfiles.rows,[{version:3,identity_text:"最新身份"}]);
  assert.equal(eventAnalysisOne.id===eventAnalysisTwo.id,false);assert.equal(transcriptOne.id===transcriptTwo.id,false);assert.equal(creatorAnalysisOne.id===creatorAnalysisTwo.id,false);
  console.log("database integration: seven migrations, ordered current switches, transcript idempotency, worker ownership, RLS, audit and schedules passed");
} finally {
  if(client)await client.end().catch(()=>undefined);
  try{docker(["rm","-f",container]);}catch{ /* Container never started or was already removed. */ }
}
