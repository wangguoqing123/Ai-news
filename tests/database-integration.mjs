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
const userOne="11111111-1111-4111-8111-111111111111";
const userTwo="22222222-2222-4222-8222-222222222222";
let client;

try {
  docker(["run","--rm","-d","--name",container,"-e","POSTGRES_PASSWORD=postgres","-p","127.0.0.1::5432","pgvector/pgvector:pg16"]);
  for(let attempt=0;attempt<60;attempt+=1){try{const logs=docker(["logs",container]);if(logs.includes("PostgreSQL init process complete")){docker(["exec",container,"pg_isready","-U","postgres"]);break}}catch{ /* Initialization is still in progress. */ }if(attempt===59)throw new Error("PostgreSQL test container did not become ready");await new Promise((resolve)=>setTimeout(resolve,500));}
  psql(`create role authenticated noinherit; create role service_role noinherit bypassrls; create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'); create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,service_role; grant select on auth.users to authenticated,service_role;`);
  psql(v1);
  psql(`insert into auth.users(id,raw_user_meta_data) values ('${userOne}','{"full_name":"Owner One"}'),('${userTwo}','{"full_name":"Owner Two"}');`);
  psql(v2);
  const port=Number(docker(["port",container,"5432/tcp"]).split(":").at(-1));
  client=new Client({host:"127.0.0.1",port,user:"postgres",password:"postgres",database:"postgres"});await client.connect();
  const workspaces=await client.query("select id,owner_id from workspaces order by owner_id");assert.equal(workspaces.rowCount,2);
  const workspaceOne=workspaces.rows.find((row)=>row.owner_id===userOne).id;const workspaceTwo=workspaces.rows.find((row)=>row.owner_id===userTwo).id;
  assert.equal((await client.query("select count(*)::int as count from job_schedules")).rows[0].count,8);
  const source=(await client.query("insert into sources(workspace_id,type,external_id,name) values($1,'aihot','aihot','AIHot') returning id",[workspaceOne])).rows[0];
  const run=(await client.query("insert into sync_runs(workspace_id,source_id,status) values($1,$2,'succeeded') returning id",[workspaceOne,source.id])).rows[0];
  const raw=(await client.query("insert into raw_ingest_records(workspace_id,source_id,sync_run_id,external_id,payload,payload_hash) values($1,$2,$3,'real-1',$4,'hash-1') returning id",[workspaceOne,source.id,run.id,{title:"真实 AIHot 内容",links:{original:"https://example.com/official"}}])).rows[0];
  const content=(await client.query("insert into content_items(workspace_id,source_id,external_id,content_type,title,canonical_url,published_at,raw_record_id) values($1,$2,'real-1','article','真实 AIHot 内容','https://example.com/official',now(),$3) returning id",[workspaceOne,source.id,raw.id])).rows[0];
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
  console.log("database integration: migrations, AIHot raw persistence, RLS, user state, topic evidence, schedules and daily brief passed");
} finally {
  if(client)await client.end().catch(()=>undefined);
  try{docker(["rm","-f",container]);}catch{ /* Container never started or was already removed. */ }
}
