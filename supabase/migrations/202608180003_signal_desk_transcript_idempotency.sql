begin;

create temporary table transcript_duplicate_map on commit drop as
select
  id as duplicate_id,
  first_value(id) over transcript_group as keeper_id,
  row_number() over transcript_group as duplicate_rank
from public.transcripts
where input_hash is not null
window transcript_group as (
  partition by workspace_id,content_id,input_hash
  order by is_current desc,created_at desc,id desc
);

create temporary table transcript_segment_duplicate_map on commit drop as
select duplicate_segment.id as duplicate_segment_id,keeper_segment.id as keeper_segment_id
from transcript_duplicate_map duplicate_transcript
join public.transcript_segments duplicate_segment
  on duplicate_segment.transcript_id=duplicate_transcript.duplicate_id
join public.transcript_segments keeper_segment
  on keeper_segment.transcript_id=duplicate_transcript.keeper_id
 and keeper_segment.segment_index=duplicate_segment.segment_index
where duplicate_transcript.duplicate_rank>1;

update public.note_source_refs reference
set transcript_segment_id=mapping.keeper_segment_id
from transcript_segment_duplicate_map mapping
where reference.transcript_segment_id=mapping.duplicate_segment_id;

update public.knowledge_card_sources reference
set transcript_segment_id=mapping.keeper_segment_id
from transcript_segment_duplicate_map mapping
where reference.transcript_segment_id=mapping.duplicate_segment_id;

update public.creator_content_analyses analysis
set transcript_id=mapping.keeper_id
from transcript_duplicate_map mapping
where mapping.duplicate_rank>1
  and analysis.transcript_id=mapping.duplicate_id;

delete from public.transcripts transcript
using transcript_duplicate_map mapping
where mapping.duplicate_rank>1
  and transcript.id=mapping.duplicate_id;

create unique index if not exists transcripts_workspace_content_input_uidx
  on public.transcripts(workspace_id,content_id,input_hash);

insert into public.signal_desk_migrations(version,name,checksum_sha256,notes)
values(202608180003,'signal_desk_transcript_idempotency',null,'Deduplicated transcript inputs and enforced at-least-once persistence idempotency')
on conflict(version) do update set
  name=excluded.name,
  applied_at=now(),
  notes=excluded.notes;

commit;
