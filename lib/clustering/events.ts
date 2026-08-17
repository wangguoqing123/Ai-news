import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTitle } from "../dedupe";
import { enqueueJob } from "../services/ingest";

export type ClusterCandidate = { id:string;title:string;summary:string|null;publishedAt:string|null;signalScore:number|null;tags:string[] };

function tokens(title:string) {
  const normalized = title.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const latin = normalized.match(/[a-z]+\d*(?:\.\d+)*/g) ?? [];
  const han = [...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap((match) => {
    const value = match[0];
    return Array.from({ length:Math.max(0,value.length-1) },(_,index) => value.slice(index,index+2));
  });
  return new Set([...latin,...han]);
}

export function eventSimilarity(left:string,right:string) {
  const a=tokens(left),b=tokens(right);
  if (!a.size || !b.size) return normalizeTitle(left) === normalizeTitle(right) ? 1 : 0;
  const intersection=[...a].filter((item) => b.has(item)).length;
  return intersection/(a.size+b.size-intersection);
}

export function groupEventCandidates(items:ClusterCandidate[]) {
  const groups:ClusterCandidate[][]=[];
  for (const item of items) {
    const group=groups.find((candidate) => candidate.some((known) => eventSimilarity(item.title,known.title)>=0.55));
    if (group) group.push(item); else groups.push([item]);
  }
  return groups;
}

function asRecord(value:unknown):Record<string,unknown> { return value && typeof value === "object" ? value as Record<string,unknown> : {}; }

export async function clusterAIHotEvents(admin:SupabaseClient,workspaceId:string,input:{ since:string;until:string }) {
  const { data,error } = await admin.from("content_items").select("id,title,summary,published_at,signal_score,metadata,source:sources!inner(type)").eq("workspace_id",workspaceId).eq("sources.type","aihot").gte("published_at",input.since).lt("published_at",input.until).is("duplicate_of_id",null).order("signal_score",{ ascending:false });
  if (error) throw new Error(error.message);
  const candidates:ClusterCandidate[]=(data ?? []).map((row) => ({ id:row.id,title:row.title,summary:row.summary,publishedAt:row.published_at,signalScore:row.signal_score,tags:Array.isArray(asRecord(row.metadata).tags) ? asRecord(row.metadata).tags as string[] : [] }));
  const groups=groupEventCandidates(candidates);
  let created=0;
  for (const group of groups) {
    const ids=group.map((item) => item.id);
    const { data:existingRelation } = await admin.from("event_cluster_items").select("cluster_id").eq("content_id",ids[0]).maybeSingle();
    const lead=[...group].sort((a,b)=>(b.signalScore ?? 0)-(a.signalScore ?? 0))[0];
    const published=group.map((item) => item.publishedAt).filter((value):value is string => Boolean(value)).sort();
    const clusterRow={ workspace_id:workspaceId,title:lead.title,summary:lead.summary,first_seen_at:published[0] ?? null,last_seen_at:published.at(-1) ?? null,
      facts:group.filter((item) => item.summary).map((item) => ({ kind:"source_summary",text:item.summary,sourceContentId:item.id,boundary:"来源摘要，尚未完成二次核对" })),
      interpretations:[],confidence:group.length>1 ? 70 : 50,importance:Math.max(...group.map((item) => item.signalScore ?? 0)),timeliness:100,
      topics:[...new Set(group.flatMap((item) => item.tags))].slice(0,5),status:"active" };
    let clusterId=existingRelation?.cluster_id as string|undefined;
    if (clusterId) {
      const { error:updateError }=await admin.from("event_clusters").update(clusterRow).eq("id",clusterId);
      if (updateError) throw new Error(updateError.message);
    } else {
      const { data:cluster,error:clusterError }=await admin.from("event_clusters").insert(clusterRow).select("id").single();
      if (clusterError || !cluster) throw new Error(clusterError?.message ?? "创建事件失败");
      clusterId=cluster.id;created+=1;
    }
    const { error:relationError }=await admin.from("event_cluster_items").upsert(ids.map((contentId) => ({ workspace_id:workspaceId,cluster_id:clusterId,content_id:contentId,relation:"report" })),{ onConflict:"cluster_id,content_id" });
    if (relationError) throw new Error(relationError.message);
    await enqueueJob(admin,{ workspaceId,type:"analyze_event",idempotencyKey:`analyze_event:${clusterId}`,payload:{ clusterId },priority:80 });
  }
  return { candidates:candidates.length,clusters:groups.length,created };
}
