begin;

with ranked as (
  select id,row_number() over(partition by workspace_id order by version desc,created_at desc,id desc) as position
  from public.content_profiles
  where is_active=true
)
update public.content_profiles p
set is_active=false
from ranked r
where p.id=r.id and r.position>1;

create unique index if not exists content_profiles_one_active_idx
  on public.content_profiles(workspace_id) where is_active;

create unique index if not exists content_versions_input_idx
  on public.content_versions(content_id,input_hash);

create or replace function public.create_content_profile_version(
  target_workspace_id uuid,
  profile_data jsonb
)
returns public.content_profiles
language plpgsql
set search_path=public
as $$
declare
  next_version integer;
  created public.content_profiles%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text,0));
  if not exists(select 1 from public.workspaces where id=target_workspace_id) then
    raise exception 'workspace does not exist';
  end if;
  select coalesce(max(version),0)+1 into next_version
  from public.content_profiles
  where workspace_id=target_workspace_id;
  update public.content_profiles set is_active=false
  where workspace_id=target_workspace_id and is_active=true;
  insert into public.content_profiles(
    workspace_id,version,is_active,identity_text,content_direction,target_audience,
    formats,focus_topics,excluded_topics,products,value_criteria,forbidden_content,historical_topics
  ) values (
    target_workspace_id,next_version,true,
    profile_data->>'identity_text',profile_data->>'content_direction',profile_data->>'target_audience',
    array(select jsonb_array_elements_text(coalesce(profile_data->'formats','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(profile_data->'focus_topics','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(profile_data->'excluded_topics','[]'::jsonb))),
    nullif(profile_data->>'products',''),coalesce(profile_data->'value_criteria','{}'::jsonb),
    array(select jsonb_array_elements_text(coalesce(profile_data->'forbidden_content','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(profile_data->'historical_topics','[]'::jsonb)))
  ) returning * into created;
  return created;
end;
$$;

create or replace function public.record_content_version(
  target_workspace_id uuid,
  target_content_id uuid,
  snapshot jsonb
)
returns public.content_versions
language plpgsql
set search_path=public
as $$
declare
  existing public.content_versions%rowtype;
  created public.content_versions%rowtype;
  next_version integer;
  target_input_hash text:=snapshot->>'input_hash';
begin
  perform pg_advisory_xact_lock(hashtextextended(target_content_id::text,0));
  if not exists(
    select 1 from public.content_items
    where id=target_content_id and workspace_id=target_workspace_id
  ) then
    raise exception 'content does not exist in workspace';
  end if;
  select * into existing from public.content_versions
  where content_id=target_content_id and input_hash=target_input_hash;
  if found then return existing; end if;
  select coalesce(max(version),0)+1 into next_version
  from public.content_versions where content_id=target_content_id;
  insert into public.content_versions(
    workspace_id,content_id,version,input_hash,payload_hash,content_fingerprint,
    title,summary,body,source_updated_at,analysis_snapshot
  ) values (
    target_workspace_id,target_content_id,next_version,target_input_hash,
    snapshot->>'payload_hash',snapshot->>'content_fingerprint',snapshot->>'title',
    snapshot->>'summary',snapshot->>'body',nullif(snapshot->>'source_updated_at','')::timestamptz,
    snapshot->'analysis_snapshot'
  ) returning * into created;
  return created;
end;
$$;

create or replace function public.activate_creator_content_analysis(
  target_workspace_id uuid,
  target_content_id uuid,
  target_analysis_id uuid
)
returns void
language plpgsql
set search_path=public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_content_id::text,0));
  if not exists(
    select 1 from public.creator_content_analyses
    where id=target_analysis_id and content_id=target_content_id and workspace_id=target_workspace_id
  ) then raise exception 'creator analysis does not exist in workspace'; end if;
  update public.creator_content_analyses
  set is_current=(id=target_analysis_id)
  where content_id=target_content_id and workspace_id=target_workspace_id
    and (is_current=true or id=target_analysis_id);
end;
$$;

create or replace function public.activate_event_analysis(
  target_workspace_id uuid,
  target_cluster_id uuid,
  target_analysis_id uuid
)
returns void
language plpgsql
set search_path=public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_cluster_id::text,0));
  if not exists(
    select 1 from public.event_analyses
    where id=target_analysis_id and cluster_id=target_cluster_id and workspace_id=target_workspace_id
  ) then raise exception 'event analysis does not exist in workspace'; end if;
  update public.event_analyses
  set is_current=(id=target_analysis_id)
  where cluster_id=target_cluster_id and workspace_id=target_workspace_id
    and (is_current=true or id=target_analysis_id);
end;
$$;

create or replace function public.activate_transcript(
  target_workspace_id uuid,
  target_content_id uuid,
  target_transcript_id uuid
)
returns void
language plpgsql
set search_path=public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_content_id::text,0));
  if not exists(
    select 1 from public.transcripts
    where id=target_transcript_id and content_id=target_content_id and workspace_id=target_workspace_id
  ) then raise exception 'transcript does not exist in workspace'; end if;
  update public.transcripts
  set is_current=(id=target_transcript_id)
  where content_id=target_content_id and workspace_id=target_workspace_id
    and (is_current=true or id=target_transcript_id);
end;
$$;

revoke all on function public.create_content_profile_version(uuid,jsonb) from public,authenticated;
revoke all on function public.record_content_version(uuid,uuid,jsonb) from public,authenticated;
revoke all on function public.activate_creator_content_analysis(uuid,uuid,uuid) from public,authenticated;
revoke all on function public.activate_event_analysis(uuid,uuid,uuid) from public,authenticated;
revoke all on function public.activate_transcript(uuid,uuid,uuid) from public,authenticated;
grant execute on function public.create_content_profile_version(uuid,jsonb) to service_role;
grant execute on function public.record_content_version(uuid,uuid,jsonb) to service_role;
grant execute on function public.activate_creator_content_analysis(uuid,uuid,uuid) to service_role;
grant execute on function public.activate_event_analysis(uuid,uuid,uuid) to service_role;
grant execute on function public.activate_transcript(uuid,uuid,uuid) to service_role;

commit;
