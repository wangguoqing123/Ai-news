import type{SupabaseClient}from"@supabase/supabase-js";
import{contentMetadataClassificationSchema,contentMetadataTranslationSchema}from"../ai/schemas";
import{getAIProvider}from"../ai/runtime";
import{sha256}from"../dedupe";
import{blockedJob,RetryableJobError}from"../jobs";
import{activeProfileVersion}from"./analysis-queue";
import{enqueueJob}from"./ingest";

const MISSING_SUMMARY="来源只提供了标题，暂无完整简介。";
const METADATA_BOUNDARY="仅依据标题与简介的初步判断";

function record(value:unknown):Record<string,unknown>{return value&&typeof value==="object"?value as Record<string,unknown>:{};}
export function containsChinese(value:string|null|undefined){if(!value)return false;const meaningful=value.replace(/\s|[\d\p{P}\p{S}]/gu,"");if(!meaningful)return false;const han=(meaningful.match(/\p{Script=Han}/gu)??[]).length;return han/meaningful.length>=.35;}
export function metadataTranslationInputHash(input:{title:string;summary:string|null}){return sha256(JSON.stringify({title:input.title,summary:input.summary??null,targetLanguage:"zh-CN"}));}

export async function enqueueMetadataProcessing(admin:SupabaseClient,input:{workspaceId:string;contentId:string;materialContentHash:string;priority?:number}){
  const base=input.priority??95;
  const translation=await enqueueJob(admin,{workspaceId:input.workspaceId,type:"translate_content_metadata",idempotencyKey:`translate_content_metadata:${input.contentId}:${input.materialContentHash}:zh-CN`,payload:{contentId:input.contentId,materialContentHash:input.materialContentHash,targetLanguage:"zh-CN"},priority:base});
  const classification=await enqueueJob(admin,{workspaceId:input.workspaceId,type:"classify_content_metadata",idempotencyKey:`classify_content_metadata:${input.contentId}:${input.materialContentHash}`,payload:{contentId:input.contentId,materialContentHash:input.materialContentHash},priority:base-5});
  return{translation,classification};
}

async function contentForMetadata(admin:SupabaseClient,workspaceId:string,contentId:string){
  const{data,error}=await admin.from("content_items").select("id,title,summary,duration_seconds,content_type,language,metadata,material_content_hash,source:sources(type,name,priority)").eq("workspace_id",workspaceId).eq("id",contentId).single();
  if(error||!data)throw new Error(error?.message??"内容不存在");return data;
}

async function promoteMetadataClassification(admin:SupabaseClient,workspaceId:string,contentId:string){const{error}=await admin.from("jobs").update({priority:96,run_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("type","classify_content_metadata").in("status",["queued","blocked"]).contains("payload",{contentId});return!error;}

async function saveTranslation(admin:SupabaseClient,input:{workspaceId:string;contentId:string;inputHash:string;title:string|null;summary:string|null;provider:string|null;status:"ready"|"skipped"|"failed";error?:string}){
  const{data,error}=await admin.from("content_translations").upsert({workspace_id:input.workspaceId,content_id:input.contentId,target_language:"zh-CN",translated_title:input.title,translated_summary:input.summary,input_hash:input.inputHash,provider:input.provider,status:input.status,is_current:false,error:input.error?.slice(0,1000)??null},{onConflict:"content_id,target_language,input_hash"}).select("id").single();
  if(error||!data)throw new Error(error?.message??"保存中文翻译失败");
  const activated=await admin.rpc("activate_content_translation",{target_workspace_id:input.workspaceId,target_content_id:input.contentId,target_translation_id:data.id,target_language_code:"zh-CN"});
  if(activated.error)throw new Error(activated.error.message);return data.id as string;
}

export async function translateContentMetadata(admin:SupabaseClient,workspaceId:string,contentId:string){
  const content=await contentForMetadata(admin,workspaceId,contentId);const metadata=record(content.metadata);const inputHash=metadataTranslationInputHash({title:content.title,summary:content.summary});
  const{data:existing,error:existingError}=await admin.from("content_translations").select("id,status,translated_title,translated_summary,provider").eq("content_id",contentId).eq("target_language","zh-CN").eq("input_hash",inputHash).maybeSingle();
  if(existingError)throw new Error(existingError.message);
  if(existing&&["ready","skipped"].includes(existing.status)){
    await admin.rpc("activate_content_translation",{target_workspace_id:workspaceId,target_content_id:contentId,target_translation_id:existing.id,target_language_code:"zh-CN"});
    await admin.from("content_items").update({metadata:{...metadata,translatedTitle:existing.translated_title,translatedSummary:existing.translated_summary,translationStatus:existing.status,translationProvider:existing.provider,translationInputHash:inputHash}}).eq("id",contentId);
    await promoteMetadataClassification(admin,workspaceId,contentId);return{status:existing.status,reused:true};
  }
  if(containsChinese(content.title)&&(!content.summary||containsChinese(content.summary))){
    const summary=content.summary?.trim()||MISSING_SUMMARY;await saveTranslation(admin,{workspaceId,contentId,inputHash,title:content.title,summary,provider:null,status:"skipped"});
    await admin.from("content_items").update({metadata:{...metadata,translatedTitle:content.title,translatedSummary:summary,translationStatus:"skipped",translationProvider:null,translationInputHash:inputHash}}).eq("id",contentId);
    await promoteMetadataClassification(admin,workspaceId,contentId);return{status:"skipped"as const,reused:false};
  }
  const provider=getAIProvider();if(!provider){await admin.from("content_items").update({metadata:{...metadata,translationStatus:"translating",translationInputHash:inputHash}}).eq("id",contentId);return blockedJob("ai_provider","中文 Metadata 翻译等待 AI Provider");}
  try{
    const result=await provider.generateStructuredDetailed({schema:contentMetadataTranslationSchema,schemaName:"content_metadata_translation",system:"你是严格的翻译器。只翻译输入中的原始标题和简介，不总结、不扩写、不解释、不补充任何不存在的信息。保留产品名、模型名和工具名，输出简体中文。必须返回结构化 JSON。简介为空时，translatedSummary 必须原样返回：来源只提供了标题，暂无完整简介。",prompt:JSON.stringify({title:content.title,summary:content.summary?.trim()||null,missingSummaryFallback:MISSING_SUMMARY,targetLanguage:"简体中文"}),temperature:0});
    const translatedSummary=content.summary?.trim()?result.data.translatedSummary:MISSING_SUMMARY;
    await saveTranslation(admin,{workspaceId,contentId,inputHash,title:result.data.translatedTitle,summary:translatedSummary,provider:result.provider,status:"ready"});
    const update=await admin.from("content_items").update({metadata:{...metadata,translatedTitle:result.data.translatedTitle,translatedSummary,translationStatus:"ready",translationProvider:result.provider,translationInputHash:inputHash}}).eq("id",contentId);if(update.error)throw new Error(update.error.message);
    await promoteMetadataClassification(admin,workspaceId,contentId);return{status:"ready"as const,provider:result.provider,inputTokens:result.inputTokens,outputTokens:result.outputTokens};
  }catch(error){const message=error instanceof Error?error.message:String(error);await saveTranslation(admin,{workspaceId,contentId,inputHash,title:null,summary:null,provider:provider.name,status:"failed",error:message});await admin.from("content_items").update({metadata:{...metadata,translationStatus:"failed",translationError:message.slice(0,300),translationInputHash:inputHash}}).eq("id",contentId);await promoteMetadataClassification(admin,workspaceId,contentId);return{status:"failed"as const,error:message};}
}

export async function classifyContentMetadata(admin:SupabaseClient,workspaceId:string,contentId:string){
  const content=await contentForMetadata(admin,workspaceId,contentId);const metadata=record(content.metadata);const materialHash=content.material_content_hash??String(metadata.analysisInputHash??"");
  const{data:translation,error:translationError}=await admin.from("content_translations").select("status,translated_title,translated_summary,input_hash").eq("content_id",contentId).eq("target_language","zh-CN").eq("is_current",true).maybeSingle();if(translationError)throw new Error(translationError.message);
  if(!translation)return blockedJob("metadata_translation","等待 Metadata 中文翻译");
  if(translation.status==="translating")throw new RetryableJobError("Metadata 中文翻译仍在处理",30_000);
  const profileVersion=await activeProfileVersion(admin,workspaceId);const{data:profile,error:profileError}=await admin.from("content_profiles").select("identity_text,content_direction,target_audience,focus_topics,historical_topics,value_criteria").eq("workspace_id",workspaceId).eq("version",profileVersion).maybeSingle();if(profileError)throw new Error(profileError.message);if(!profile)return blockedJob("content_profile","内容画像不存在");
  const inputHash=sha256(JSON.stringify({materialHash,translationHash:translation.input_hash,profileVersion,sourcePriority:(content.source as unknown as{priority?:number}|null)?.priority??0}));const{data:existing,error:existingError}=await admin.from("content_metadata_classifications").select("id,status,recommendation,reason,matched_topics,possible_value,confidence,boundary,provider").eq("content_id",contentId).eq("input_hash",inputHash).maybeSingle();if(existingError)throw new Error(existingError.message);
  if(existing?.status==="ready"){await admin.rpc("activate_content_metadata_classification",{target_workspace_id:workspaceId,target_content_id:contentId,target_classification_id:existing.id});await admin.from("content_items").update({processing_status:"ready",metadata:{...metadata,metadataClassification:{recommendation:existing.recommendation,reason:existing.reason,matchedTopics:existing.matched_topics,possibleValue:existing.possible_value,confidence:Number(existing.confidence),boundary:existing.boundary},metadataClassificationStatus:"ready"}}).eq("id",contentId);return{status:"ready"as const,reused:true};}
  const provider=getAIProvider();if(!provider)return blockedJob("ai_provider","Metadata 初步判断等待 AI Provider");
  const result=await provider.generateStructuredDetailed({schema:contentMetadataClassificationSchema,schemaName:"content_metadata_classification",system:"你是内容价值初筛器。只能根据标题、简介、中文翻译、博主优先级、视频时长、contentKind、当前内容画像、历史选题和当前重点主题判断。绝不能假设看过字幕或完整视频。所有字段使用简体中文，boundary 必须严格为“仅依据标题与简介的初步判断”。",prompt:JSON.stringify({originalTitle:content.title,originalSummary:content.summary,translatedTitle:translation.translated_title,translatedSummary:translation.translated_summary,creatorPriority:(content.source as unknown as{priority?:number}|null)?.priority??0,durationSeconds:content.duration_seconds,contentKind:content.content_type,profile:{identity:profile.identity_text,direction:profile.content_direction,audience:profile.target_audience,valueCriteria:profile.value_criteria},historicalTopics:profile.historical_topics,focusTopics:profile.focus_topics}),temperature:.1});
  const output={...result.data,boundary:METADATA_BOUNDARY};const{data:stored,error:storeError}=await admin.from("content_metadata_classifications").upsert({workspace_id:workspaceId,content_id:contentId,recommendation:output.recommendation,reason:output.reason,matched_topics:output.matchedTopics,possible_value:output.possibleValue,confidence:output.confidence,boundary:output.boundary,input_hash:inputHash,provider:result.provider,status:"ready",is_current:false,error:null},{onConflict:"content_id,input_hash"}).select("id").single();if(storeError||!stored)throw new Error(storeError?.message??"保存初步判断失败");const activated=await admin.rpc("activate_content_metadata_classification",{target_workspace_id:workspaceId,target_content_id:contentId,target_classification_id:stored.id});if(activated.error)throw new Error(activated.error.message);const learningScore={process_first:90,quick_scan:60,topic_signal:35,low_priority:5,pending:0}[output.recommendation];const topicScore=output.recommendation==="topic_signal"?75:output.matchedTopics.length?40:0;const update=await admin.from("content_items").update({processing_status:"ready",learning_score:learningScore,topic_signal_score:topicScore,metadata:{...metadata,metadataClassification:output,metadataClassificationStatus:"ready",metadataClassificationProvider:result.provider}}).eq("id",contentId);if(update.error)throw new Error(update.error.message);
  return{status:"ready"as const,recommendation:output.recommendation,confidence:output.confidence};
}

export{MISSING_SUMMARY,METADATA_BOUNDARY};
