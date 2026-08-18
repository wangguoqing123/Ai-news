begin;

create table if not exists public.signal_desk_migrations (
  version bigint primary key,
  name text not null,
  checksum_sha256 text,
  applied_at timestamptz not null default now(),
  applied_via text not null default 'sql_editor',
  notes text
);

alter table public.signal_desk_migrations enable row level security;
revoke all on public.signal_desk_migrations from public,anon,authenticated;
grant select,insert,update on public.signal_desk_migrations to service_role;

insert into public.signal_desk_migrations(version,name,checksum_sha256,notes)
values
  (202608170002,'signal_desk_v2','7685ca02feec87994cc5bd5932c1389eedbed59d35db387f49fbb3e9042c8444','Applied after production backup'),
  (202608170003,'signal_desk_reliable_daily','6c7ba927cd5b21a58fa9d56671e2053a7fc7d3878d393351b5debeaf453f2e88','Enum value committed separately before transactional remainder in Supabase SQL Editor'),
  (202608180001,'signal_desk_concurrency','42d46698332f4e655c93638345b070d9b6405193cf26024fe5aeeb7dd794d119','Transactional current switches and optimistic concurrency support'),
  (202608180002,'signal_desk_migration_audit',null,'Self-recorded deployment audit')
on conflict(version) do update set
  name=excluded.name,
  checksum_sha256=excluded.checksum_sha256,
  applied_at=now(),
  applied_via=excluded.applied_via,
  notes=excluded.notes;

commit;
