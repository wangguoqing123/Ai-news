import type { SupabaseClient } from "@supabase/supabase-js";
import { GetNotesConnector,getNotesConfigSchema } from "../connectors/get-notes";
import { clusterCrossSourceTopics } from "../clustering/cross-source";
import { fieldMappingSchema } from "../connectors/generic-json";
import { ensureSource,finishSyncRun,persistNormalizedContent,startSyncRun } from "./ingest";
import { enqueueGetNotesProcessing } from "./get-notes-processing";

export const defaultGetNotesMapping=fieldMappingSchema.parse({itemsPath:"data.items",nextCursorPath:"data.nextCursor",fields:{externalId:"id",title:"title",summary:"summary",body:"body",author:"creator.name",canonicalUrl:"url",publishedAt:"publishedAt",updatedAt:"updatedAt",thumbnailUrl:"cover",tags:"tags",creatorId:"creator.id",platform:"platform",likes:"metrics.likes",comments:"metrics.comments",saves:"metrics.saves",shares:"metrics.shares",commentsContent:"comments"}});

export async function syncGetNotesApi(admin:SupabaseClient,workspaceId:string,options:{maxPages?:number}={}){
  const baseUrl=process.env.GET_NOTES_BASE_URL;const token=process.env.GET_NOTES_API_TOKEN;const knowledgeBaseId=process.env.GET_NOTES_KNOWLEDGE_BASE_ID;
  if(!baseUrl || !token || !knowledgeBaseId)throw new Error("Get 笔记 API 配置不完整");
  const mapping=process.env.GET_NOTES_FIELD_MAPPING ? fieldMappingSchema.parse(JSON.parse(process.env.GET_NOTES_FIELD_MAPPING)) : defaultGetNotesMapping;
  const config=getNotesConfigSchema.parse({baseUrl,path:"",method:"GET",headers:{Authorization:`Bearer ${token}`},query:{knowledgeBaseId},mapping,knowledgeBaseId});
  const connector=new GetNotesConnector();const source=await ensureSource(admin,{workspaceId,type:"get_notes",externalId:knowledgeBaseId,name:"Get 笔记 · 竞品内容",processingMode:"automatic_deep",metadata:{mode:"api",knowledgeBaseId}});const runId=await startSyncRun(admin,{workspaceId,sourceId:source.id});
  let cursor:string|null=null,pages=0,fetched=0,normalized=0,duplicates=0;
  try{
    do{const page=await connector.fetchPage({config,cursor});pages+=1;fetched+=page.items.length;for(const raw of page.items){const item=connector.normalizeWithMapping(raw,mapping);item.sourceMetadata={...item.sourceMetadata,knowledgeBaseId,provenance:"verified_live",interactionStatus:item.sourceMetadata.interactionAvailable?"available":"unavailable",hasTranscript:Boolean(item.body),transcriptStatus:item.body?"text_only_no_timestamps":"unavailable"};const persisted=await persistNormalizedContent(admin,{workspaceId,sourceId:source.id,sourceType:"get_notes",syncRunId:runId,raw,normalized:item});normalized+=1;if(persisted.duplicateOfId)duplicates+=1;if(persisted.shouldAnalyze)await enqueueGetNotesProcessing(admin,{workspaceId,contentId:persisted.id,contentHash:persisted.contentHash,hasTranscript:Boolean(item.body)});}cursor=page.hasMore?page.nextCursor??null:null;}while(cursor && pages<(options.maxPages ?? 50));
    const crossSource=await clusterCrossSourceTopics(admin,workspaceId);await finishSyncRun(admin,{runId,sourceId:source.id,fetched,normalized,errors:0,metrics:{pages,duplicates,crossSource}});return{source:"get_notes" as const,status:"verified_live" as const,mode:"api" as const,pages,fetched,normalized,duplicates,crossSource};
  }catch(error){await finishSyncRun(admin,{runId,sourceId:source.id,fetched,normalized,errors:1,error:error instanceof Error?error.message:String(error),metrics:{pages,duplicates}});throw error;}
}

export function normalizeWebhookItems(payload:unknown){
  const body=payload && typeof payload === "object" ? payload as Record<string,unknown> : {};const items=Array.isArray(body.items)?body.items:[];const connector=new GetNotesConnector();
  return items.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object")).map((raw)=>({raw,normalized:connector.normalizeWithMapping(raw,defaultGetNotesMapping)}));
}
