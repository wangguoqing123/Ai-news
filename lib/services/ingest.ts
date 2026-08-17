import type { SupabaseClient } from "@supabase/supabase-js";
import { contentFingerprints,sha256 } from "../dedupe";
import type { NormalizedContent } from "../connectors/types";

export type IngestSourceType = "aihot"|"youtube"|"get_notes";

function cleanText(value:string){return value.replaceAll("\u0000","").replace(/[\uD800-\uDFFF]/g,(unit,index,text)=>{const code=unit.charCodeAt(0);const previous=index?text.charCodeAt(index-1):0;const next=index+1<text.length?text.charCodeAt(index+1):0;if(code>=0xD800&&code<=0xDBFF&&next>=0xDC00&&next<=0xDFFF)return unit;if(code>=0xDC00&&code<=0xDFFF&&previous>=0xD800&&previous<=0xDBFF)return unit;return"�"})}
function cleanJson(value:unknown):unknown{if(typeof value==="string")return cleanText(value);if(Array.isArray(value))return value.map(cleanJson);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([,item])=>item!==undefined).map(([key,item])=>[key,cleanJson(item)]));return value}

export async function ensureSource(admin:SupabaseClient,input:{ workspaceId:string;type:IngestSourceType;externalId:string;name:string;connectionId?:string|null;iconUrl?:string|null;metadata?:Record<string,unknown> }) {
  const { data:existing }=await admin.from("sources").select("metadata").eq("workspace_id",input.workspaceId).eq("type",input.type).eq("external_id",input.externalId).maybeSingle();
  const { data,error } = await admin.from("sources").upsert({
    workspace_id:input.workspaceId,type:input.type,external_id:input.externalId,name:input.name,connection_id:input.connectionId ?? null,
    icon_url:input.iconUrl ?? null,status:"active",last_error:null,metadata:{ ...(existing?.metadata as Record<string,unknown> ?? {}),...(input.metadata ?? {}) },
  },{ onConflict:"workspace_id,type,external_id" }).select("id,metadata").single();
  if (error || !data) throw new Error(`保存 ${input.name} 来源失败：${error?.message ?? "unknown"}`);
  return data as { id:string;metadata:Record<string,unknown> };
}

export async function startSyncRun(admin:SupabaseClient,input:{ workspaceId:string;sourceId:string }) {
  const { data,error } = await admin.from("sync_runs").insert({ workspace_id:input.workspaceId,source_id:input.sourceId,status:"running" }).select("id").single();
  if (error || !data) throw new Error(`创建同步记录失败：${error?.message ?? "unknown"}`);
  return data.id as string;
}

export async function finishSyncRun(admin:SupabaseClient,input:{ runId:string;sourceId:string;fetched:number;normalized:number;errors:number;error?:string|null;metrics?:Record<string,unknown> }) {
  const status = input.error ? "failed" : input.errors ? "partial_success" : "succeeded";
  const finishedAt = new Date().toISOString();
  const partialError=input.errors ? `${input.errors} 个同步项失败；详情见最近一次同步记录` : null;
  const sourceUpdate = input.error ? { last_error:input.error } : { last_success_at:finishedAt,last_error:partialError };
  const [runResult,sourceResult] = await Promise.all([
    admin.from("sync_runs").update({ status,finished_at:finishedAt,fetched_count:input.fetched,normalized_count:input.normalized,error_count:input.errors,error:input.error ?? null,metrics:input.metrics ?? {} }).eq("id",input.runId),
    admin.from("sources").update(sourceUpdate).eq("id",input.sourceId),
  ]);
  if (runResult.error) throw new Error(runResult.error.message);
  if (sourceResult.error) throw new Error(sourceResult.error.message);
}

export async function persistNormalizedContent(admin:SupabaseClient,input:{
  workspaceId:string;sourceId:string;sourceType:IngestSourceType;syncRunId:string;raw:unknown;normalized:NormalizedContent;
}) {
  const safeRaw=cleanJson(input.raw);const payload = JSON.stringify(safeRaw);
  const payloadHash = sha256(payload);
  const { data:rawRecord,error:rawError } = await admin.from("raw_ingest_records").upsert({
    workspace_id:input.workspaceId,source_id:input.sourceId,sync_run_id:input.syncRunId,external_id:cleanText(input.normalized.externalId),payload:safeRaw,payload_hash:payloadHash,
  },{ onConflict:"source_id,external_id,payload_hash",ignoreDuplicates:false }).select("id").single();
  if (rawError || !rawRecord) throw new Error(`保存原始记录失败：${rawError?.message ?? "unknown"}`);

  const fingerprints = contentFingerprints({ sourceType:input.sourceType,externalId:input.normalized.externalId,canonicalUrl:input.normalized.canonicalUrl,title:input.normalized.title,body:input.normalized.body });
  const { data:existing,error:existingError } = await admin.from("content_items").select("id,metadata,status").eq("source_id",input.sourceId).eq("external_id",input.normalized.externalId).maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let duplicateOfId:string|null = null;
  if (!existing) {
    if (input.normalized.canonicalUrl) {
      const { data:canonicalMatch } = await admin.from("content_items").select("id").eq("workspace_id",input.workspaceId).eq("canonical_url",input.normalized.canonicalUrl).limit(1).maybeSingle();
      duplicateOfId = canonicalMatch?.id ?? null;
    }
    if (!duplicateOfId) {
      const { data:titleMatches } = await admin.from("content_items").select("id").eq("workspace_id",input.workspaceId).contains("metadata",{ titleFingerprint:fingerprints.title }).limit(1);
      duplicateOfId = titleMatches?.[0]?.id ?? null;
    }
  }
  const editorialScore = input.normalized.metrics.editorialScore;
  const metadata = cleanJson({ ...(existing?.metadata as Record<string,unknown> ?? {}),...input.normalized.sourceMetadata,titleFingerprint:fingerprints.title,canonicalFingerprint:fingerprints.canonical,bodyFingerprint:fingerprints.body,metrics:input.normalized.metrics,tags:input.normalized.tags,sourceUpdatedAt:input.normalized.updatedAt }) as Record<string,unknown>;
  const row = {
    workspace_id:input.workspaceId,source_id:input.sourceId,external_id:input.normalized.externalId,content_type:input.normalized.contentType,
    title:cleanText(input.normalized.title),summary:input.normalized.summary?cleanText(input.normalized.summary):null,body:input.normalized.body?cleanText(input.normalized.body):null,author:input.normalized.author?cleanText(input.normalized.author):null,canonical_url:input.normalized.canonicalUrl,
    published_at:input.normalized.publishedAt,language:input.normalized.language,duration_seconds:input.normalized.durationSeconds,thumbnail_url:input.normalized.thumbnailUrl,
    raw_record_id:rawRecord.id,processing_status:"pending",signal_score:typeof editorialScore === "number" ? Math.round(editorialScore) : null,
    duplicate_of_id:existing ? undefined : duplicateOfId,status:existing?.status ?? "unread",metadata,
  };
  const operation = existing ? admin.from("content_items").update(row).eq("id",existing.id) : admin.from("content_items").insert(row);
  const { data:content,error:contentError } = await operation.select("id").single();
  if (contentError || !content) throw new Error(`保存标准化内容失败：${contentError?.message ?? "unknown"}`);
  if (duplicateOfId) await admin.from("content_duplicates").upsert({ workspace_id:input.workspaceId,content_id:content.id,duplicate_of_id:duplicateOfId,method:"exact_fingerprint",similarity:1 },{ onConflict:"content_id,duplicate_of_id" });
  return { id:content.id as string,created:!existing,duplicateOfId };
}

export async function enqueueJob(admin:SupabaseClient,input:{ workspaceId:string;type:string;idempotencyKey:string;payload:Record<string,unknown>;priority?:number }) {
  const { error } = await admin.from("jobs").upsert({ workspace_id:input.workspaceId,type:input.type,status:"queued",priority:input.priority ?? 100,idempotency_key:input.idempotencyKey,payload:input.payload },{ onConflict:"workspace_id,idempotency_key",ignoreDuplicates:true });
  if (error) throw new Error(`创建任务失败：${error.message}`);
}
