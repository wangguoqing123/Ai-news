import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTitle } from "../dedupe";
import { clusterInputHash,enqueueEventAnalysis } from "../services/analysis-queue";

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

export function clusterBaseUpdate(input:{workspaceId:string;lead:ClusterCandidate;group:ClusterCandidate[];published:string[];inputHash:string}){return{workspace_id:input.workspaceId,title:input.lead.title,summary:input.lead.summary,first_seen_at:input.published[0]??null,last_seen_at:input.published.at(-1)??null,facts:input.group.filter(item=>item.summary).map(item=>({kind:"source_summary",text:item.summary,sourceContentId:item.id,boundary:"来源原始摘要，尚未完成二次核对"})),confidence:input.group.length>1?70:50,importance:Math.max(...input.group.map(item=>item.signalScore??0)),timeliness:100,topics:[...new Set(input.group.flatMap(item=>item.tags))].slice(0,5),status:"active",analysis_input_hash:input.inputHash};}

function asRecord(value:unknown):Record<string,unknown> { return value && typeof value === "object" ? value as Record<string,unknown> : {}; }

export async function clusterAIHotEvents(admin:SupabaseClient,workspaceId:string,input:{ since:string;until:string }) {
  const { data,error } = await admin.from("content_items").select("id,title,summary,published_at,signal_score,metadata,source:sources!inner(type)").eq("workspace_id",workspaceId).eq("sources.type","aihot").gte("published_at",input.since).lt("published_at",input.until).is("duplicate_of_id",null).order("signal_score",{ ascending:false });
  if (error) throw new Error(error.message);
  const candidates:ClusterCandidate[]=(data ?? []).map((row) => ({ id:row.id,title:row.title,summary:row.summary,publishedAt:row.published_at,signalScore:row.signal_score,tags:Array.isArray(asRecord(row.metadata).tags) ? asRecord(row.metadata).tags as string[] : [] }));
  const groups=groupEventCandidates(candidates);
  let created=0,merged=0;
  for (const group of groups) {
    const ids=group.map((item) => item.id);
    const { data:existingRelations,error:relationReadError } = await admin.from("event_cluster_items").select("cluster_id,cluster:event_clusters(status)").eq("workspace_id",workspaceId).in("content_id",ids);if(relationReadError)throw new Error(relationReadError.message);const existingClusterIds=[...new Set((existingRelations??[]).filter(item=>{const cluster=Array.isArray(item.cluster)?item.cluster[0]:item.cluster;return cluster?.status==="active";}).map(item=>item.cluster_id))];
    const lead=[...group].sort((a,b)=>(b.signalScore ?? 0)-(a.signalScore ?? 0))[0];
    const published=group.map((item) => item.publishedAt).filter((value):value is string => Boolean(value)).sort();
    const inputHash=clusterInputHash(ids);const clusterRow=clusterBaseUpdate({workspaceId,lead,group,published,inputHash});
    const{data:clusterId,error:reconcileError}=await admin.rpc("reconcile_event_cluster_group",{target_workspace_id:workspaceId,candidate_ids:ids,cluster_payload:clusterRow});if(reconcileError||!clusterId)throw new Error(reconcileError?.message??"事件聚类事务失败");if(!existingClusterIds.length)created+=1;if(existingClusterIds.length>1)merged+=existingClusterIds.length-1;const{data:reconciled,error:reconciledError}=await admin.from("event_clusters").select("analysis_input_hash").eq("id",clusterId).single();if(reconciledError||!reconciled)throw new Error(reconciledError?.message??"读取事件聚类失败");await enqueueEventAnalysis(admin,{workspaceId,clusterId,inputHash:reconciled.analysis_input_hash??inputHash,priority:80});
  }
  return { candidates:candidates.length,clusters:groups.length,created,merged };
}
