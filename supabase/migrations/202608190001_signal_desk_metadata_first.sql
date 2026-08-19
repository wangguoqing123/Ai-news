begin;

alter table public.content_items
  add column if not exists source_material_hash text,
  add column if not exists material_content_hash text,
  add column if not exists metrics_hash text,
  add column if not exists processing_mode text not null default 'metadata_only';

alter table public.content_items
  drop constraint if exists content_items_processing_mode_check,
  add constraint content_items_processing_mode_check check (processing_mode in (
    'metadata_only','deep_requested','fetching_transcript','translating_transcript',
    'analyzing','ready','limited_ready','failed'
  ));

update public.content_items
set material_content_hash=coalesce(material_content_hash,analysis_input_hash),
    source_material_hash=coalesce(source_material_hash,material_content_hash,analysis_input_hash),
    metrics_hash=coalesce(metrics_hash,encode(digest(coalesce(metadata->'metrics','{}'::jsonb)::text,'sha256'),'hex')),
    processing_mode=case
      when processing_mode<>'metadata_only' then processing_mode
      when coalesce((metadata->>'hasTranscript')::boolean,false)
        and jsonb_typeof(metadata->'creatorAnalysis')='object' then 'ready'
      else 'metadata_only'
    end;

update public.jobs job
set status='cancelled',result=jsonb_build_object('reason','cancelled_by_youtube_metadata_first_policy'),
    locked_at=null,locked_by=null,lease_expires_at=null,heartbeat_at=null
where job.status in ('queued','blocked')
  and job.type in ('fetch_transcript','analyze_creator_content')
  and exists(
    select 1 from public.content_items content
    join public.sources source on source.id=content.source_id
    where content.id::text=job.payload->>'contentId' and source.type='youtube'
  );

insert into public.jobs(workspace_id,type,status,priority,idempotency_key,payload)
select content.workspace_id,'translate_content_metadata','queued',95,
       'translate_content_metadata:'||content.id::text||':'||coalesce(content.source_material_hash,content.analysis_input_hash,'legacy')||':zh-CN',
       jsonb_build_object('contentId',content.id,'materialContentHash',coalesce(content.source_material_hash,content.analysis_input_hash,'legacy'),'targetLanguage','zh-CN')
from public.content_items content join public.sources source on source.id=content.source_id
where source.type='youtube' and content.duplicate_of_id is null
on conflict(workspace_id,idempotency_key) do nothing;

insert into public.jobs(workspace_id,type,status,priority,idempotency_key,payload)
select content.workspace_id,'classify_content_metadata','queued',90,
       'classify_content_metadata:'||content.id::text||':'||coalesce(content.source_material_hash,content.analysis_input_hash,'legacy'),
       jsonb_build_object('contentId',content.id,'materialContentHash',coalesce(content.source_material_hash,content.analysis_input_hash,'legacy'))
from public.content_items content join public.sources source on source.id=content.source_id
where source.type='youtube' and content.duplicate_of_id is null
on conflict(workspace_id,idempotency_key) do nothing;

alter table public.content_metrics_snapshots
  add column if not exists metrics_hash text;
create unique index if not exists content_metrics_snapshots_input_uidx
  on public.content_metrics_snapshots(content_id,metrics_hash);

create table if not exists public.content_translations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  target_language text not null default 'zh-CN',
  translated_title text,
  translated_summary text,
  input_hash text not null,
  provider text,
  status text not null default 'translating' check(status in ('translating','ready','skipped','failed')),
  is_current boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(content_id,target_language,input_hash)
);
create unique index if not exists content_translations_current_uidx
  on public.content_translations(content_id,target_language) where is_current;

create table if not exists public.content_metadata_classifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  recommendation text not null default 'pending' check(recommendation in ('process_first','quick_scan','topic_signal','low_priority','pending')),
  reason text,
  matched_topics jsonb not null default '[]',
  possible_value text,
  confidence numeric not null default 0 check(confidence between 0 and 1),
  boundary text not null default '仅依据标题与简介的初步判断',
  input_hash text not null,
  provider text,
  status text not null default 'pending' check(status in ('pending','ready','blocked','failed')),
  is_current boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(content_id,input_hash)
);
create unique index if not exists content_metadata_classifications_current_uidx
  on public.content_metadata_classifications(content_id) where is_current;

create table if not exists public.content_processing_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  mode text not null default 'deep' check(mode='deep'),
  status text not null default 'queued' check(status in ('queued','fetching_transcript','translating_transcript','analyzing','ready','limited_ready','failed')),
  current_stage text not null default 'request_deep_processing',
  transcript_job_id uuid references public.jobs(id) on delete set null,
  translation_job_id uuid references public.jobs(id) on delete set null,
  analysis_job_id uuid references public.jobs(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists content_processing_requests_one_active_uidx
  on public.content_processing_requests(content_id)
  where status in ('queued','fetching_transcript','translating_transcript','analyzing');
create index if not exists content_processing_requests_workspace_idx
  on public.content_processing_requests(workspace_id,requested_at desc);

alter table public.transcripts
  add column if not exists translation_status text not null default 'pending',
  add column if not exists translation_input_hash text,
  add column if not exists translation_target_language text,
  add column if not exists translated_at timestamptz;

alter table public.event_clusters
  add column if not exists merged_into_id uuid references public.event_clusters(id) on delete set null,
  add column if not exists merged_at timestamptz;

update public.daily_briefs set status='final' where status='ready';

with ranked as (
  select i.id,row_number() over(
    partition by i.workspace_id,i.content_id
    order by (c.status='active') desc,c.importance desc nulls last,c.created_at,i.created_at,i.id
  ) as position
  from public.event_cluster_items i
  join public.event_clusters c on c.id=i.cluster_id
)
delete from public.event_cluster_items item
using ranked
where item.id=ranked.id and ranked.position>1;

create unique index if not exists event_cluster_items_one_cluster_uidx
  on public.event_cluster_items(workspace_id,content_id);

create or replace function public.activate_content_translation(
  target_workspace_id uuid,target_content_id uuid,target_translation_id uuid,target_language_code text
)
returns void language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_content_id::text||':'||target_language_code,0));
  if not exists(select 1 from public.content_translations where id=target_translation_id and workspace_id=target_workspace_id and content_id=target_content_id) then
    raise exception 'translation does not exist in workspace';
  end if;
  update public.content_translations set is_current=false
  where workspace_id=target_workspace_id and content_id=target_content_id and target_language=target_language_code and is_current=true and id<>target_translation_id;
  update public.content_translations set is_current=true where id=target_translation_id;
end;
$$;

create or replace function public.activate_content_metadata_classification(
  target_workspace_id uuid,target_content_id uuid,target_classification_id uuid
)
returns void language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_content_id::text,0));
  if not exists(select 1 from public.content_metadata_classifications where id=target_classification_id and workspace_id=target_workspace_id and content_id=target_content_id) then
    raise exception 'metadata classification does not exist in workspace';
  end if;
  update public.content_metadata_classifications set is_current=false
  where workspace_id=target_workspace_id and content_id=target_content_id and is_current=true and id<>target_classification_id;
  update public.content_metadata_classifications set is_current=true where id=target_classification_id;
end;
$$;

create or replace function public.reconcile_event_cluster_group(
  target_workspace_id uuid,candidate_ids uuid[],cluster_payload jsonb
)
returns uuid language plpgsql set search_path=public as $$
declare
  primary_id uuid;
  source_ids uuid[];
  member_ids uuid[];
  next_hash text;
  old_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':event-clusters',0));
  select array_agg(distinct c.id order by c.id) into source_ids
  from public.event_clusters c
  join public.event_cluster_items i on i.cluster_id=c.id
  where c.workspace_id=target_workspace_id and c.status='active' and i.content_id=any(candidate_ids);

  if coalesce(array_length(source_ids,1),0)=0 then
    insert into public.event_clusters(workspace_id,title,summary,first_seen_at,last_seen_at,facts,confidence,importance,timeliness,topics,status,analysis_input_hash)
    values(target_workspace_id,cluster_payload->>'title',cluster_payload->>'summary',nullif(cluster_payload->>'first_seen_at','')::timestamptz,nullif(cluster_payload->>'last_seen_at','')::timestamptz,coalesce(cluster_payload->'facts','[]'::jsonb),(cluster_payload->>'confidence')::integer,(cluster_payload->>'importance')::integer,(cluster_payload->>'timeliness')::integer,array(select jsonb_array_elements_text(coalesce(cluster_payload->'topics','[]'::jsonb))),'active',cluster_payload->>'analysis_input_hash')
    returning id into primary_id;
  else
    select c.id into primary_id from public.event_clusters c
    where c.id=any(source_ids)
    order by c.importance desc nulls last,c.created_at,c.id limit 1;
    select analysis_input_hash into old_hash from public.event_clusters where id=primary_id;
    insert into public.event_cluster_items(workspace_id,cluster_id,content_id,relation)
    select target_workspace_id,primary_id,i.content_id,i.relation
    from public.event_cluster_items i
    where i.cluster_id=any(source_ids)
    on conflict(workspace_id,content_id) do update set cluster_id=excluded.cluster_id,relation=excluded.relation;
    update public.event_clusters
    set status='merged',merged_into_id=primary_id,merged_at=now()
    where id=any(source_ids) and id<>primary_id;
    update public.event_analyses set is_current=false
    where cluster_id=any(source_ids) and cluster_id<>primary_id and is_current=true;
  end if;

  insert into public.event_cluster_items(workspace_id,cluster_id,content_id,relation)
  select target_workspace_id,primary_id,id,'report' from unnest(candidate_ids) id
  on conflict(workspace_id,content_id) do update set cluster_id=excluded.cluster_id,relation='report';

  delete from public.event_cluster_items where cluster_id=any(coalesce(source_ids,'{}'::uuid[])) and cluster_id<>primary_id;
  select array_agg(content_id order by content_id) into member_ids from public.event_cluster_items where cluster_id=primary_id;
  select encode(digest(coalesce(string_agg(id::text,':' order by id::text),''),'sha256'),'hex') into next_hash from unnest(member_ids) id;

  update public.event_clusters set
    title=cluster_payload->>'title',summary=cluster_payload->>'summary',
    first_seen_at=(select min(published_at) from public.content_items where id=any(member_ids)),
    last_seen_at=(select max(published_at) from public.content_items where id=any(member_ids)),
    facts=(select coalesce(jsonb_agg(jsonb_build_object('kind','source_summary','text',summary,'sourceContentId',id,'boundary','来源原始摘要，尚未完成二次核对')) filter(where summary is not null),'[]'::jsonb) from public.content_items where id=any(member_ids)),
    confidence=case when array_length(member_ids,1)>1 then 70 else 50 end,
    importance=(select max(signal_score) from public.content_items where id=any(member_ids)),
    timeliness=100,topics=array(select jsonb_array_elements_text(coalesce(cluster_payload->'topics','[]'::jsonb))),
    status='active',merged_into_id=null,merged_at=null,analysis_input_hash=next_hash
  where id=primary_id;
  if old_hash is distinct from next_hash then
    update public.event_analyses set is_current=false where cluster_id=primary_id and is_current=true;
  end if;
  return primary_id;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['content_translations','content_metadata_classifications','content_processing_requests'] loop
    if not exists(select 1 from pg_trigger where tgname=format('set_%s_updated_at',t)) then
      execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
    end if;
    execute format('alter table public.%I enable row level security',t);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_workspace_access') then
      execute format('create policy %I_workspace_access on public.%I for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))',t,t);
    end if;
  end loop;
end $$;

grant select,insert,update,delete on public.content_translations,public.content_metadata_classifications,public.content_processing_requests to authenticated,service_role;
revoke all on function public.activate_content_translation(uuid,uuid,uuid,text) from public,authenticated;
revoke all on function public.activate_content_metadata_classification(uuid,uuid,uuid) from public,authenticated;
revoke all on function public.reconcile_event_cluster_group(uuid,uuid[],jsonb) from public,authenticated;
grant execute on function public.activate_content_translation(uuid,uuid,uuid,text) to service_role;
grant execute on function public.activate_content_metadata_classification(uuid,uuid,uuid) to service_role;
grant execute on function public.reconcile_event_cluster_group(uuid,uuid[],jsonb) to service_role;

update public.job_schedules set cron_expression='40 6 * * *',next_run_at=(date_trunc('day',next_run_at at time zone timezone)+interval '6 hours 40 minutes') at time zone timezone
where job_type='generate_daily_brief';

insert into public.signal_desk_migrations(version,name,checksum_sha256,notes)
values(202608190001,'signal_desk_metadata_first',null,'YouTube metadata-first processing, translations, deep requests, cluster reconciliation and daily brief states')
on conflict(version) do update set name=excluded.name,applied_at=now(),notes=excluded.notes;

commit;
