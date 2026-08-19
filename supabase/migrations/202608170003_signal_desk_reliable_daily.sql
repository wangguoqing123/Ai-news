alter type public.job_status add value if not exists 'blocked' after 'running';

begin;

alter table public.content_profiles
  add column if not exists historical_topics text[] not null default '{}';

alter table public.content_items
  add column if not exists analysis_input_hash text,
  add column if not exists content_fingerprint text;

create table if not exists public.content_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  version integer not null,
  input_hash text not null,
  payload_hash text,
  content_fingerprint text,
  title text not null,
  summary text,
  body text,
  source_updated_at timestamptz,
  analysis_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(content_id,version)
);

alter table public.transcripts
  add column if not exists has_timestamps boolean not null default true,
  add column if not exists failure_reason text,
  add column if not exists source_url text,
  add column if not exists input_hash text,
  add column if not exists metadata jsonb not null default '{}',
  add column if not exists is_current boolean not null default true,
  add column if not exists fetched_at timestamptz;

create unique index if not exists transcripts_current_content_idx
  on public.transcripts(content_id) where is_current;

alter table public.creator_content_analyses
  drop constraint if exists creator_content_analyses_content_id_key,
  drop constraint if exists creator_content_analyses_status_check;
alter table public.creator_content_analyses
  add column if not exists input_hash text not null default 'legacy',
  add column if not exists content_hash text not null default 'legacy',
  add column if not exists prompt_version text not null default 'legacy',
  add column if not exists profile_version integer not null default 0,
  add column if not exists analysis_version text not null default 'legacy',
  add column if not exists transcript_id uuid references public.transcripts(id) on delete set null,
  add column if not exists is_current boolean not null default true,
  add constraint creator_content_analyses_status_check check (status in ('analysis_pending','blocked','ready','failed'));
create unique index if not exists creator_content_analyses_version_idx
  on public.creator_content_analyses(content_id,input_hash,prompt_version,profile_version,analysis_version);
create unique index if not exists creator_content_analyses_current_idx
  on public.creator_content_analyses(content_id) where is_current;

alter table public.event_analyses
  drop constraint if exists event_analyses_cluster_id_key,
  drop constraint if exists event_analyses_status_check;
alter table public.event_analyses
  add column if not exists input_hash text not null default 'legacy',
  add column if not exists prompt_version text not null default 'legacy',
  add column if not exists profile_version integer not null default 0,
  add column if not exists analysis_version text not null default 'legacy',
  add column if not exists confirmed_facts jsonb not null default '[]',
  add column if not exists official_claims jsonb not null default '[]',
  add column if not exists media_interpretations jsonb not null default '[]',
  add column if not exists unconfirmed_claims jsonb not null default '[]',
  add column if not exists is_current boolean not null default true,
  add constraint event_analyses_status_check check (status in ('analysis_pending','blocked','ready','failed'));
create unique index if not exists event_analyses_version_idx
  on public.event_analyses(cluster_id,input_hash,prompt_version,profile_version,analysis_version);
create unique index if not exists event_analyses_current_idx
  on public.event_analyses(cluster_id) where is_current;

alter table public.event_clusters
  add column if not exists analysis_input_hash text;

alter table public.trend_clusters
  add column if not exists window_counts jsonb not null default '{}',
  add column if not exists source_counts jsonb not null default '{}',
  add column if not exists trend_basis text,
  add column if not exists expression_difference text,
  add column if not exists differentiated_topic text,
  add column if not exists input_hash text;

alter table public.jobs
  add column if not exists blocked_reason text,
  add column if not exists dependency_type text,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists metrics jsonb not null default '{}';

create table if not exists public.worker_heartbeats (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null unique,
  status text not null default 'active',
  current_job_id uuid references public.jobs(id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_blocked_retry_idx
  on public.jobs(status,next_retry_at) where status = 'blocked';
create index if not exists jobs_running_heartbeat_idx
  on public.jobs(status,lease_expires_at,heartbeat_at) where status = 'running';
create index if not exists content_versions_content_idx
  on public.content_versions(content_id,version desc);
create index if not exists worker_heartbeats_seen_idx
  on public.worker_heartbeats(status,last_seen_at desc);

do $$
declare t text;
begin
  foreach t in array array['content_versions','worker_heartbeats'] loop
    if not exists(select 1 from pg_trigger where tgname = format('set_%s_updated_at',t)) then
      execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
    end if;
  end loop;
end $$;

alter table public.content_versions enable row level security;
create policy content_versions_workspace_access on public.content_versions for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

alter table public.worker_heartbeats enable row level security;
create policy worker_heartbeats_service_read on public.worker_heartbeats for select
  using (true);

grant select,insert,update,delete on public.content_versions to authenticated,service_role;
grant select,insert,update,delete on public.worker_heartbeats to service_role;

update public.content_profiles
set identity_text = 'AI 内容创作者、独立开发者、互联网产品经理',
    content_direction = 'AI 工具真实实测、AI 编程、AI 工作流、AI 教程、效果展示',
    target_audience = '希望使用 AI 提升开发、工作、学习和内容创作效率的人',
    formats = array['竖屏短视频','横屏教程','图文','一题多做'],
    focus_topics = array['AI 编程','Claude Code','Cursor','AI 工具实测','AI 工作流','AI 教程','AI 视频','AI 学习方法'],
    value_criteria = jsonb_build_object(
      'text','能改变具体行动；有真实证据；可以实际演示；不是重复转述；能形成教程、实测或判断；适合当前账号受众。'
    )
where is_active = true
  and coalesce(identity_text,'') = ''
  and coalesce(content_direction,'') = ''
  and coalesce(target_audience,'') = '';

commit;
