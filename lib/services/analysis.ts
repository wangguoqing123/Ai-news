import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProvider } from "../ai/runtime";
import { creatorContentAnalysisSchema,eventAnalysisSchema } from "../ai/schemas";

function record(value:unknown):Record<string,unknown>{return value && typeof value === "object" ? value as Record<string,unknown> : {};}

async function profile(admin:SupabaseClient,workspaceId:string){const {data}=await admin.from("content_profiles").select("identity_text,content_direction,target_audience,formats,focus_topics,excluded_topics,products,value_criteria,forbidden_content").eq("workspace_id",workspaceId).eq("is_active",true).order("version",{ascending:false}).limit(1).maybeSingle();return data ?? {};}

export async function analyzeCreatorContent(admin:SupabaseClient,workspaceId:string,contentId:string){
  const {data:content,error}=await admin.from("content_items").select("id,title,summary,body,author,duration_seconds,metadata,source:sources(type,name)").eq("workspace_id",workspaceId).eq("id",contentId).single();if(error||!content)throw new Error(error?.message??"内容不存在");
  const provider=getAIProvider();const metadata=record(content.metadata);
  if(!provider){await admin.from("content_items").update({processing_status:"pending",metadata:{...metadata,analysisStatus:"analysis_pending",analysisPendingReason:"AI Provider 未配置"}}).eq("id",contentId);return{status:"analysis_pending" as const};}
  const userProfile=await profile(admin,workspaceId);const evidenceRef=`content:${contentId}`;
  const analysis=await provider.generateStructured({schema:creatorContentAnalysisSchema,schemaName:"creator_content_analysis",system:"你是内容研究分析师。必须只根据给定内容和用户画像判断，不得补写不存在的观看数据、互动数据、字幕或事实。证据引用只能使用提供的 evidenceRef。",prompt:JSON.stringify({userProfile,content:{title:content.title,summary:content.summary,body:content.body,author:content.author,durationSeconds:content.duration_seconds,source:content.source,evidenceRef}}),temperature:0.1});
  analysis.evidenceRefs=[evidenceRef];const learningScore={deep_learn:90,quick_scan:60,topic_signal:30,ignore:0,pending:0}[analysis.learningRecommendation];const topicScore=analysis.topicOpportunity.available?75:0;
  const {error:updateError}=await admin.from("content_items").update({processing_status:"ready",learning_score:learningScore,topic_signal_score:topicScore,metadata:{...metadata,analysisStatus:"ready",creatorAnalysis:analysis}}).eq("id",contentId);if(updateError)throw new Error(updateError.message);
  const stored=await admin.from("creator_content_analyses").upsert({workspace_id:workspaceId,content_id:contentId,status:"ready",summary:analysis.summary,content_type:analysis.contentType,target_audience:analysis.targetAudience,problem_solved:analysis.problemSolved,core_points:analysis.corePoints,learning_recommendation:analysis.learningRecommendation,learning_reason:analysis.learningReason,learning_takeaways:analysis.learningTakeaways,recommended_segments:analysis.recommendedSegments,topic_opportunity:analysis.topicOpportunity,evidence_refs:analysis.evidenceRefs,confidence:analysis.confidence},{onConflict:"content_id"});
  if(stored.error && stored.error.code!=="42P01")throw new Error(stored.error.message);
  return{status:"ready" as const,recommendation:analysis.learningRecommendation};
}

export async function analyzeEvent(admin:SupabaseClient,workspaceId:string,clusterId:string){
  const {data:cluster,error}=await admin.from("event_clusters").select("id,title,summary,facts,topics,items:event_cluster_items(content:content_items(id,title,summary,body,canonical_url,author,published_at))").eq("workspace_id",workspaceId).eq("id",clusterId).single();if(error||!cluster)throw new Error(error?.message??"事件不存在");
  const provider=getAIProvider();if(!provider)return{status:"analysis_pending" as const};const userProfile=await profile(admin,workspaceId);
  const evidence=(cluster.items ?? []).flatMap((item:{content:unknown})=>{const content=record(item.content);return[{evidenceRef:`content:${content.id}`,title:content.title,summary:content.summary,body:content.body,author:content.author,url:content.canonical_url,publishedAt:content.published_at}]});
  const analysis=await provider.generateStructured({schema:eventAnalysisSchema,schemaName:"event_analysis",system:"你是严谨的 AI 新闻编辑。区分已确认事实、官方说法、媒体解释和未确认信息。不得将来源摘要自动视为已确认事实。必须只引用提供的 evidenceRef，并结合用户画像解释相关性。",prompt:JSON.stringify({userProfile,event:{title:cluster.title,summary:cluster.summary,topics:cluster.topics},evidence}),temperature:0.1});
  const {error:updateError}=await admin.from("event_clusters").update({summary:analysis.happened,interpretations:[{whyImportant:analysis.whyImportant,whyRelevant:analysis.whyRelevant,contentOpportunity:analysis.contentOpportunity}],confidence:Math.round(analysis.confidence*100)}).eq("id",clusterId);if(updateError)throw new Error(updateError.message);
  const stored=await admin.from("event_analyses").upsert({workspace_id:workspaceId,cluster_id:clusterId,status:"ready",happened:analysis.happened,real_change:analysis.realChange,why_important:analysis.whyImportant,why_relevant:analysis.whyRelevant,content_opportunity:analysis.contentOpportunity,claim_boundaries:analysis.claimBoundaries,evidence_refs:analysis.evidenceRefs,confidence:analysis.confidence},{onConflict:"cluster_id"});if(stored.error&&stored.error.code!=="42P01")throw new Error(stored.error.message);
  return{status:"ready" as const};
}
