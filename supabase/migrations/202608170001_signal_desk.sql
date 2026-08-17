begin;

create extension if not exists pgcrypto;
create extension if not exists vector;

create type public.source_type as enum ('youtube','aihot','get_notes','rss','generic_api','webhook','manual');
create type public.processing_status as enum ('pending','processing','ready','failed');
create type public.job_status as enum ('queued','running','succeeded','failed','dead_letter','cancelled');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid generated always as (id) stored,
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text,
  locale text not null default 'zh-CN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role text not null default 'owner',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,user_id)
);

create table public.content_profiles (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version integer not null default 1, identity_text text, content_direction text, target_audience text,
  formats text[] not null default '{}', focus_topics text[] not null default '{}', excluded_topics text[] not null default '{}',
  products text, value_criteria jsonb not null default '{}', forbidden_content text[] not null default '{}', is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,version)
);

create table public.topic_preferences (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic text not null, weight integer not null default 50 check (weight between 0 and 100), negative boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,topic)
);

create table public.source_connections (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type public.source_type not null, name text not null, status text not null default 'disconnected', encrypted_config text,
  config_version integer not null default 1, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,type)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid references public.source_connections(id) on delete set null, external_id text, name text not null, type public.source_type not null,
  icon_url text, status text not null default 'active', priority integer not null default 50, trust_level integer not null default 50,
  processing_mode text not null default 'normal', sync_frequency_minutes integer not null default 360, last_success_at timestamptz,
  last_error text, next_sync_at timestamptz, paused_at timestamptz, tags text[] not null default '{}', metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,type,external_id)
);

create table public.source_subscriptions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade, external_id text not null, name text not null,
  enabled boolean not null default true, priority integer not null default 50, muted boolean not null default false,
  tags text[] not null default '{}', metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,source_id,external_id)
);

create table public.source_field_mappings (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.source_connections(id) on delete cascade, version integer not null, mapping jsonb not null,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(connection_id,version)
);

create table public.sync_cursors (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade, cursor text, since_at timestamptz, cursor_data jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_id)
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null, status text not null, started_at timestamptz not null default now(), finished_at timestamptz,
  fetched_count integer not null default 0, normalized_count integer not null default 0, error_count integer not null default 0,
  error text, metrics jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.raw_ingest_records (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade, sync_run_id uuid references public.sync_runs(id) on delete set null,
  external_id text not null, payload jsonb not null, payload_hash text not null, mapping_version integer,
  received_at timestamptz not null default now(), replayed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(source_id,external_id,payload_hash)
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade, external_id text not null, content_type text not null,
  title text not null, summary text, body text, author text, canonical_url text, published_at timestamptz, language text,
  duration_seconds integer, thumbnail_url text, raw_record_id uuid references public.raw_ingest_records(id) on delete set null,
  processing_status public.processing_status not null default 'pending', signal_score integer, learning_score integer, topic_signal_score integer,
  duplicate_of_id uuid references public.content_items(id) on delete set null, status text not null default 'unread', metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_id,external_id)
);

create index content_items_workspace_published_idx on public.content_items(workspace_id,published_at desc);
create index content_items_workspace_status_idx on public.content_items(workspace_id,status);
create index content_items_search_idx on public.content_items using gin (to_tsvector('simple',coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body,'')));

create table public.content_assets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade, type text not null, storage_path text, external_url text,
  mime_type text, metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.content_metrics_snapshots (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade, captured_at timestamptz not null default now(), metrics jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.content_topics (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade, topic text not null, confidence numeric,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(content_id,topic)
);
create table public.content_embeddings (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade, chunk_index integer not null default 0, chunk_text text not null,
  model text not null, embedding vector(1536) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(content_id,chunk_index,model)
);
create index content_embeddings_hnsw_idx on public.content_embeddings using hnsw (embedding vector_cosine_ops);
create table public.content_duplicates (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade, duplicate_of_id uuid not null references public.content_items(id) on delete cascade,
  method text not null, similarity numeric, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(content_id,duplicate_of_id)
);
create table public.transcripts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade, language text not null, provider text not null,
  is_auto_generated boolean not null default false, confidence numeric, status text not null default 'ready',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transcript_id uuid not null references public.transcripts(id) on delete cascade, segment_index integer not null, start_ms bigint not null, end_ms bigint not null,
  text text not null, translated_text text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(transcript_id,segment_index)
);

create table public.event_clusters (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null, summary text, first_seen_at timestamptz, last_seen_at timestamptz, facts jsonb not null default '[]', interpretations jsonb not null default '[]',
  confidence integer, importance integer, timeliness integer, topics text[] not null default '{}', status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.event_cluster_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cluster_id uuid not null references public.event_clusters(id) on delete cascade, content_id uuid not null references public.content_items(id) on delete cascade,
  relation text not null default 'report', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(cluster_id,content_id)
);
create table public.trend_clusters (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null, status text not null check(status in ('emerging','rising','stable','declining','isolated')), window_days integer not null,
  evidence_count integer not null default 0, has_metrics boolean not null default false, summary text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.trend_cluster_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cluster_id uuid not null references public.trend_clusters(id) on delete cascade, content_id uuid not null references public.content_items(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(cluster_id,content_id)
);

create table public.learning_sessions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade, goal text not null, status text not null default 'learning',
  started_at timestamptz not null default now(), completed_at timestamptz, mastery_confirmed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.learning_progress (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id uuid not null references public.learning_sessions(id) on delete cascade, position_ms bigint not null default 0, watched_ms bigint not null default 0,
  last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(session_id)
);
create table public.user_notes (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid references public.content_items(id) on delete set null, note_type text not null default 'judgement', markdown text not null,
  timestamp_ms bigint, tags text[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.note_source_refs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null references public.user_notes(id) on delete cascade, content_id uuid references public.content_items(id) on delete cascade,
  transcript_segment_id uuid references public.transcript_segments(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.quizzes (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade, ai_run_id uuid, status text not null default 'ready',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade, type text not null, prompt text not null, rubric jsonb not null default '{}', source_refs jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade, answers jsonb not null, result jsonb, submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.practice_tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, purpose text, input text, steps jsonb not null default '[]', completion_criteria jsonb not null default '[]', due_at timestamptz,
  status text not null default 'open', result text, retrospective text, source_refs jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.knowledge_cards (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null, type text not null, content text not null, use_cases text, prerequisites text, user_addition text,
  tags text[] not null default '{}', confidence integer, topics text[] not null default '{}', usage_count integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.knowledge_card_sources (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  card_id uuid not null references public.knowledge_cards(id) on delete cascade, content_id uuid references public.content_items(id) on delete cascade,
  transcript_segment_id uuid references public.transcript_segments(id) on delete set null, note_id uuid references public.user_notes(id) on delete set null,
  timestamp_ms bigint, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.knowledge_card_relations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_card_id uuid not null references public.knowledge_cards(id) on delete cascade, to_card_id uuid not null references public.knowledge_cards(id) on delete cascade,
  relation text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(from_card_id,to_card_id,relation)
);
create table public.review_schedules (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  card_id uuid not null references public.knowledge_cards(id) on delete cascade, due_at timestamptz not null, interval_days integer not null default 7,
  status text not null default 'due', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.topic_candidates (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic text not null, target_audience text, pain_point text, trigger_scene text, expected_result text, core_viewpoint text,
  differentiated_angle text, why_now text, assumptions jsonb not null default '[]', validation_task text, recommended_format text,
  duplicate_score integer, risk jsonb not null default '[]', status text not null default 'candidate', creation_source text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.topic_sources (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id uuid not null references public.topic_candidates(id) on delete cascade, source_type text not null, source_id uuid not null, purpose text not null,
  excerpt text, timestamp_ms bigint, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.topic_scores (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id uuid not null references public.topic_candidates(id) on delete cascade, frequency smallint not null, emotion smallint not null,
  cost smallint not null, scene smallint not null, commercial smallint not null, timeliness integer, credibility integer,
  demonstrability integer, novelty integer, user_fit integer, historical_similarity integer, total integer not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(topic_id)
);
create table public.content_briefs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id uuid not null references public.topic_candidates(id) on delete cascade, title_directions jsonb not null default '[]', hook text,
  user_problem text, conclusion text, structure jsonb not null default '[]', demo_steps jsonb not null default '[]', required_assets jsonb not null default '[]',
  source_refs jsonb not null default '[]', risks jsonb not null default '[]', ending_action text, aspect_ratio text, duration_seconds integer,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.content_outputs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id uuid not null references public.topic_candidates(id) on delete cascade, type text not null, title text, url text, published_at timestamptz,
  metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.performance_snapshots (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  output_id uuid not null references public.content_outputs(id) on delete cascade, captured_at timestamptz not null default now(), metrics jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.daily_briefs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brief_date date not null, timezone text not null, status text not null default 'ready', summary jsonb not null default '{}', completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,brief_date)
);
create table public.daily_brief_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brief_id uuid not null references public.daily_briefs(id) on delete cascade, item_type text not null, source_id uuid, rank integer not null,
  reason text, action_status text not null default 'pending', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(brief_id,item_type,rank)
);
create table public.feedback_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null, entity_type text not null, entity_id uuid, metadata jsonb not null default '{}', occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ranking_profiles (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  weights jsonb not null default '{}', learned_from_count integer not null default 0, reset_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id)
);
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, query text not null, filters jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null, status public.job_status not null default 'queued', priority integer not null default 100, run_at timestamptz not null default now(),
  locked_at timestamptz, locked_by text, lease_expires_at timestamptz, attempt integer not null default 0, max_attempts integer not null default 5,
  idempotency_key text not null, payload jsonb not null default '{}', result jsonb, error text, timeout_seconds integer not null default 300,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,idempotency_key)
);
create index jobs_claim_idx on public.jobs(status,run_at,priority desc) where status='queued';
create table public.job_attempts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade, attempt integer not null, worker_id text, started_at timestamptz not null default now(),
  finished_at timestamptz, status text not null, error text, metrics jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ai_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_type text not null, entity_type text, entity_id uuid, provider text not null, model text not null, prompt_version text not null,
  input_tokens integer not null default 0, output_tokens integer not null default 0, cost_usd numeric(12,6) not null default 0,
  duration_ms integer, status text not null, error text, input_hash text, output jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, version text not null, template text not null, output_schema jsonb not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,name,version)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, action text not null, entity_type text, entity_id uuid, before_data jsonb, after_data jsonb,
  ip_hash text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null, title text not null, body text, read_at timestamptz, action_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','profiles','workspace_members','content_profiles','topic_preferences','source_connections','sources','source_subscriptions',
    'source_field_mappings','sync_cursors','sync_runs','raw_ingest_records','content_items','content_assets','content_metrics_snapshots','content_topics',
    'content_embeddings','content_duplicates','transcripts','transcript_segments','event_clusters','event_cluster_items','trend_clusters','trend_cluster_items',
    'learning_sessions','learning_progress','user_notes','note_source_refs','quizzes','quiz_questions','quiz_attempts','practice_tasks','knowledge_cards',
    'knowledge_card_sources','knowledge_card_relations','review_schedules','topic_candidates','topic_sources','topic_scores','content_briefs','content_outputs',
    'performance_snapshots','daily_briefs','daily_brief_items','feedback_events','ranking_profiles','saved_searches','jobs','job_attempts','ai_runs',
    'prompt_versions','audit_logs','notifications'
  ] loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()) $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare new_workspace_id uuid;
begin
  insert into public.workspaces(name,owner_id) values(coalesce(new.raw_user_meta_data->>'full_name','我的工作区'),new.id) returning id into new_workspace_id;
  insert into public.workspace_members(workspace_id,user_id,role) values(new_workspace_id,new.id,'owner');
  insert into public.profiles(id,workspace_id,display_name) values(new.id,new_workspace_id,new.raw_user_meta_data->>'full_name');
  insert into public.content_profiles(workspace_id,version,is_active) values(new_workspace_id,1,true);
  insert into public.ranking_profiles(workspace_id,weights) values(new_workspace_id,'{}');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.workspaces enable row level security;
create policy workspaces_select on public.workspaces for select using (owner_id=auth.uid() or public.is_workspace_member(id));
create policy workspaces_update on public.workspaces for update using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy workspaces_delete on public.workspaces for delete using (owner_id=auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','workspace_members','content_profiles','topic_preferences','source_connections','sources','source_subscriptions','source_field_mappings',
    'sync_cursors','sync_runs','raw_ingest_records','content_items','content_assets','content_metrics_snapshots','content_topics','content_embeddings',
    'content_duplicates','transcripts','transcript_segments','event_clusters','event_cluster_items','trend_clusters','trend_cluster_items','learning_sessions',
    'learning_progress','user_notes','note_source_refs','quizzes','quiz_questions','quiz_attempts','practice_tasks','knowledge_cards','knowledge_card_sources',
    'knowledge_card_relations','review_schedules','topic_candidates','topic_sources','topic_scores','content_briefs','content_outputs','performance_snapshots',
    'daily_briefs','daily_brief_items','feedback_events','ranking_profiles','saved_searches','jobs','job_attempts','ai_runs','prompt_versions','audit_logs','notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_workspace_access on public.%I for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', t, t);
  end loop;
end $$;

-- Data API privileges are explicit because new-table auto exposure is disabled.
-- RLS policies remain the authorization boundary for authenticated users.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

commit;
