import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreatorItem, CrossSignal, DailyBriefEntry, EvidenceLink, LearningRecommendation, TodayEvent, TodayPayload } from "../domain/signal-desk";

export type ContentRow = {
  id:string;title:string;summary:string|null;author:string|null;canonical_url:string|null;published_at:string|null;
  duration_seconds:number|null;thumbnail_url:string|null;learning_score:number|null;topic_signal_score:number|null;processing_status:string;
  metadata:Record<string,unknown>|null;source:{ type:"aihot"|"youtube"|"get_notes";name:string;icon_url:string|null }|null;
};

type ClusterRow = {
  id:string;title:string;summary:string|null;first_seen_at:string|null;last_seen_at:string|null;importance:number|null;topics:string[]|null;
  facts:unknown;interpretations:unknown;status:string;
};

function beijingRange(date:string) {
  const start = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) throw new Error("日期格式无效");
  const end = new Date(start.getTime()+86_400_000);
  return { start:start.toISOString(),end:end.toISOString() };
}

function asRecord(value:unknown):Record<string,unknown> { return value && typeof value === "object" ? value as Record<string,unknown> : {}; }
function asStrings(value:unknown):string[] { return Array.isArray(value) ? value.filter((item):item is string => typeof item === "string") : []; }
function asText(value:unknown):string|null { return typeof value === "string" && value.trim() ? value : null; }

function recommendationFor(row:ContentRow):LearningRecommendation {
  const analysis = asRecord(row.metadata?.creatorAnalysis);
  const value = analysis.learningRecommendation;
  if (["deep_learn","quick_scan","topic_signal","ignore","pending"].includes(String(value))) return value as LearningRecommendation;
  return "pending";
}

export function creatorFrom(row:ContentRow):CreatorItem {
  const metadata = asRecord(row.metadata);
  const analysis = asRecord(metadata.creatorAnalysis);
  const userState=asRecord(metadata.userState);
  const sourceType = row.source?.type === "get_notes" ? "get_notes" : "youtube";
  return {
    id:row.id,sourceType,platform:sourceType === "youtube" ? "YouTube" : metadata.platform === "douyin" ? "抖音" : "其他",
    creatorName:row.author ?? row.source?.name ?? "未知博主",creatorAvatarUrl:asText(metadata.creatorAvatarUrl),publishedAt:row.published_at,
    durationSeconds:row.duration_seconds,title:row.title,translatedTitle:asText(metadata.translatedTitle),summary:row.summary,
    thumbnailUrl:row.thumbnail_url,canonicalUrl:row.canonical_url,hasTranscript:Boolean(metadata.hasTranscript),
    interactionAvailable:metadata.interactionAvailable === true,recommendation:recommendationFor(row),
    recommendationReason:asText(analysis.learningReason),learningTakeaways:asStrings(analysis.learningTakeaways),
    topicOpportunity:asText(asRecord(analysis.topicOpportunity).angle),analysisStatus:row.processing_status === "ready" && Object.keys(analysis).length ? "ready" : "pending",
    state:{isRead:userState.isRead===true,isSaved:userState.isSaved===true,watchLater:userState.watchLater===true,isIgnored:userState.isIgnored===true,notInterested:userState.notInterested===true,queuedLearning:userState.queuedLearning===true},
  };
}

function levelFor(importance:number|null):TodayEvent["level"] {
  if ((importance ?? 0) >= 80) return "重大";
  if ((importance ?? 0) >= 50) return "值得关注";
  return "了解即可";
}

export async function readToday(admin:SupabaseClient,workspaceId:string,date:string):Promise<TodayPayload> {
  const { start,end } = beijingRange(date);
  const [contentResult,clusterResult,briefResult,topicResult,sourceResult,trendResult] = await Promise.all([
    admin.from("content_items").select("id,title,summary,author,canonical_url,published_at,duration_seconds,thumbnail_url,learning_score,topic_signal_score,processing_status,metadata,source:sources(type,name,icon_url)").eq("workspace_id",workspaceId).gte("published_at",start).lt("published_at",end).is("duplicate_of_id",null).order("published_at",{ ascending:false }).limit(100),
    admin.from("event_clusters").select("id,title,summary,first_seen_at,last_seen_at,importance,topics,facts,interpretations,status").eq("workspace_id",workspaceId).gte("last_seen_at",start).lt("last_seen_at",end).eq("status","active").order("importance",{ ascending:false }).limit(10),
    admin.from("daily_briefs").select("id,summary,status,completed_at").eq("workspace_id",workspaceId).eq("brief_date",date).maybeSingle(),
    admin.from("topic_candidates").select("id",{ count:"exact",head:true }).eq("workspace_id",workspaceId).gte("created_at",start).lt("created_at",end).neq("status","abandoned"),
    admin.from("sources").select("last_success_at").eq("workspace_id",workspaceId).not("last_success_at","is",null).order("last_success_at",{ ascending:false }).limit(1),
    admin.from("trend_clusters").select("id,title,status,window_days,summary,items:trend_cluster_items(content:content_items(source:sources(type)))").eq("workspace_id",workspaceId).in("status",["emerging","rising","stable"]).order("evidence_count",{ascending:false}).limit(10),
  ]);
  for (const result of [contentResult,clusterResult,briefResult,topicResult,sourceResult,trendResult]) if (result.error) throw new Error(result.error.message);
  const content = (contentResult.data ?? []) as unknown as ContentRow[];
  const creators = content.filter((row) => row.source?.type === "youtube" || row.source?.type === "get_notes").map(creatorFrom);

  const eventIds = (clusterResult.data ?? []).map((cluster) => cluster.id);
  const { data:relations,error:relationError } = eventIds.length ? await admin.from("event_cluster_items").select("cluster_id,content_id").eq("workspace_id",workspaceId).in("cluster_id",eventIds) : { data:[],error:null };
  if (relationError) throw new Error(relationError.message);
  const linkedIds = [...new Set((relations ?? []).map((item) => item.content_id))];
  const { data:linkedRows,error:linkedError } = linkedIds.length ? await admin.from("content_items").select("id,title,canonical_url,published_at,source:sources(type,name)").in("id",linkedIds) : { data:[],error:null };
  if (linkedError) throw new Error(linkedError.message);
  const evidenceById = new Map<string,EvidenceLink>((linkedRows ?? []).map((row) => {
    const source = row.source as unknown as { type:"aihot"|"youtube"|"get_notes";name:string }|null;
    return [row.id,{ id:row.id,title:row.title,url:row.canonical_url,sourceType:source?.type ?? "aihot",sourceName:source?.name ?? "未知来源",publishedAt:row.published_at }];
  }));
  const relationMap = new Map<string,EvidenceLink[]>();
  for (const relation of relations ?? []) {
    const evidence = evidenceById.get(relation.content_id);
    if (!evidence) continue;
    relationMap.set(relation.cluster_id,[...(relationMap.get(relation.cluster_id) ?? []),evidence]);
  }
  const events:TodayEvent[] = ((clusterResult.data ?? []) as ClusterRow[]).map((cluster) => {
    const evidence = relationMap.get(cluster.id) ?? [];
    const facts = Array.isArray(cluster.facts) ? cluster.facts.map(asRecord) : [];
    const interpretations = Array.isArray(cluster.interpretations) ? cluster.interpretations.map(asRecord) : [];
    return { id:cluster.id,level:levelFor(cluster.importance),category:cluster.topics?.[0] ?? "AI 动态",publishedAt:cluster.last_seen_at,title:cluster.title,
      happened:cluster.summary,realChange:asText(facts[0]?.text),whyImportant:asText(interpretations[0]?.whyImportant),whyRelevant:asText(interpretations[0]?.whyRelevant),
      primarySource:evidence[0] ?? null,secondarySourceCount:Math.max(0,evidence.length-1),relatedCreatorCount:evidence.filter((item) => item.sourceType !== "aihot").length,
      contentOpportunity:asText(interpretations[0]?.contentOpportunity),evidence,analysisStatus:interpretations.length ? "ready" : "pending" };
  });
  const briefSummary = asRecord(briefResult.data?.summary);
  const brief = (Array.isArray(briefSummary.entries) ? briefSummary.entries : []).filter((item):item is DailyBriefEntry => Boolean(item && typeof item === "object" && "title" in item));
  const crossSignals:CrossSignal[]=(trendResult.data??[]).map((trend)=>{const sourceTypes=(trend.items??[]).flatMap((item:{content:unknown})=>{const content=asRecord(item.content);const source=asRecord(content.source);return typeof source.type==="string"?[source.type]:[]});return{id:trend.id,title:trend.title,aihotCount:sourceTypes.filter(type=>type==="aihot").length,youtubeCount:sourceTypes.filter(type=>type==="youtube").length,competitorCount:sourceTypes.filter(type=>type==="get_notes").length,windowLabel:`过去 ${trend.window_days} 天`,trendStatus:trend.status==="rising"?"正在升温":trend.status==="stable"?"持续关注":"信号较弱",expressionDifference:null,differentiatedTopic:null}});
  return {
    mode:"live",date,windowLabel:"过去 24 小时",
    stats:{ importantEvents:events.filter((item) => item.level !== "了解即可").length,creatorUpdates:creators.length,deepLearning:creators.filter((item) => item.recommendation === "deep_learn").length,topicOpportunities:topicResult.count ?? 0 },
    lastSyncedAt:sourceResult.data?.[0]?.last_success_at ?? null,briefStatus:briefResult.data ? "ready" : "missing",brief,
    events,creators:creators.slice(0,12),crossSignals,
  };
}
