begin;

alter function public.reconcile_event_cluster_group(uuid,uuid[],jsonb)
  set search_path=public,extensions;

insert into public.signal_desk_migrations(version,name,checksum_sha256,notes)
values(202608190002,'signal_desk_cluster_digest_path',null,'Allow event cluster hash calculation to resolve pgcrypto from the Supabase extensions schema')
on conflict(version) do update set name=excluded.name,applied_at=now(),notes=excluded.notes;

commit;
