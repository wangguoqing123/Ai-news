begin;

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
  set is_current=false
  where content_id=target_content_id and workspace_id=target_workspace_id
    and is_current=true and id<>target_analysis_id;
  update public.creator_content_analyses
  set is_current=true
  where id=target_analysis_id and content_id=target_content_id and workspace_id=target_workspace_id;
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
  set is_current=false
  where cluster_id=target_cluster_id and workspace_id=target_workspace_id
    and is_current=true and id<>target_analysis_id;
  update public.event_analyses
  set is_current=true
  where id=target_analysis_id and cluster_id=target_cluster_id and workspace_id=target_workspace_id;
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
  set is_current=false
  where content_id=target_content_id and workspace_id=target_workspace_id
    and is_current=true and id<>target_transcript_id;
  update public.transcripts
  set is_current=true
  where id=target_transcript_id and content_id=target_content_id and workspace_id=target_workspace_id;
end;
$$;

revoke all on function public.activate_creator_content_analysis(uuid,uuid,uuid) from public,authenticated;
revoke all on function public.activate_event_analysis(uuid,uuid,uuid) from public,authenticated;
revoke all on function public.activate_transcript(uuid,uuid,uuid) from public,authenticated;
grant execute on function public.activate_creator_content_analysis(uuid,uuid,uuid) to service_role;
grant execute on function public.activate_event_analysis(uuid,uuid,uuid) to service_role;
grant execute on function public.activate_transcript(uuid,uuid,uuid) to service_role;

insert into public.signal_desk_migrations(version,name,checksum_sha256,notes)
values(202608180004,'signal_desk_activation_order',null,'Split current deactivation and activation to avoid immediate unique-index checks')
on conflict(version) do update set
  name=excluded.name,
  applied_at=now(),
  notes=excluded.notes;

commit;
