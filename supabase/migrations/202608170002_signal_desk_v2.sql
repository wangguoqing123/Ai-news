begin;

create table if not exists public.creator_content_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  status text not null default 'analysis_pending' check (status in ('analysis_pending','ready','failed')),
  summary text,
  content_type text,
  target_audience text,
  problem_solved text,
  core_points jsonb not null default '[]',
  learning_recommendation text not null default 'pending' check (learning_recommendation in ('deep_learn','quick_scan','topic_signal','ignore','pending')),
  learning_reason text,
  learning_takeaways jsonb not null default '[]',
  recommended_segments jsonb not null default '[]',
  topic_opportunity jsonb not null default '{"available":false}',
  evidence_refs jsonb not null default '[]',
  confidence numeric,
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(content_id)
);

create table if not exists public.event_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cluster_id uuid not null references public.event_clusters(id) on delete cascade,
  status text not null default 'analysis_pending' check (status in ('analysis_pending','ready','failed')),
  happened text,
  real_change text,
  why_important text,
  why_relevant text,
  content_opportunity text,
  claim_boundaries jsonb not null default '[]',
  evidence_refs jsonb not null default '[]',
  confidence numeric,
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cluster_id)
);

create table if not exists public.content_user_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  is_read boolean not null default false,
  is_saved boolean not null default false,
  watch_later boolean not null default false,
  is_ignored boolean not null default false,
  not_interested boolean not null default false,
  queued_learning boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,content_id)
);

create table if not exists public.subscription_sync_cursors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subscription_id uuid not null references public.source_subscriptions(id) on delete cascade,
  cursor text,
  last_external_id text,
  last_published_at timestamptz,
  last_success_at timestamptz,
  quota_cost integer not null default 0,
  state jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id)
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type public.source_type not null,
  delivery_id text not null,
  signature_version text not null default 'v1',
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,source_type,delivery_id)
);

create table if not exists public.job_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_type text not null,
  cron_expression text not null,
  timezone text not null default 'Asia/Shanghai',
  enabled boolean not null default true,
  last_enqueued_at timestamptz,
  next_run_at timestamptz,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,job_type)
);

create index if not exists creator_analysis_recommendation_idx on public.creator_content_analyses(workspace_id,learning_recommendation,updated_at desc);
create index if not exists content_user_states_queue_idx on public.content_user_states(workspace_id,user_id,queued_learning,updated_at desc);
create index if not exists webhook_deliveries_received_idx on public.webhook_deliveries(workspace_id,received_at desc);
create index if not exists job_schedules_next_run_idx on public.job_schedules(enabled,next_run_at);

do $$
declare t text;
begin
  foreach t in array array['creator_content_analyses','event_analyses','content_user_states','subscription_sync_cursors','webhook_deliveries','job_schedules'] loop
    if not exists(select 1 from pg_trigger where tgname = format('set_%s_updated_at',t)) then
      execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
    end if;
    execute format('alter table public.%I enable row level security',t);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t || '_workspace_access') then
      execute format('create policy %I_workspace_access on public.%I for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))',t,t);
    end if;
  end loop;
end $$;

grant select,insert,update,delete on public.creator_content_analyses,public.event_analyses,public.content_user_states,public.subscription_sync_cursors,public.webhook_deliveries,public.job_schedules to authenticated,service_role;

insert into public.job_schedules(workspace_id,job_type,cron_expression,timezone,next_run_at)
select w.id,s.job_type,s.cron_expression,w.timezone,(date_trunc('day',now() at time zone w.timezone)+interval '1 day'+s.local_time) at time zone w.timezone
from public.workspaces w
cross join (values
  ('sync_aihot','15 6 * * *',time '06:15'),
  ('sync_youtube_channel_videos','20 6 * * *',time '06:20'),
  ('sync_get_notes','25 6 * * *',time '06:25'),
  ('generate_daily_brief','30 6 * * *',time '06:30')
) as s(job_type,cron_expression,local_time)
on conflict(workspace_id,job_type) do nothing;

commit;
