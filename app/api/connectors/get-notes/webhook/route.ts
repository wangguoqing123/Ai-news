import { normalizeWebhookItems } from "../../../../../lib/services/get-notes-api-sync";
import { ensureSource,finishSyncRun,persistNormalizedContent,startSyncRun,enqueueJob } from "../../../../../lib/services/ingest";
import { getSupabaseAdmin } from "../../../../../lib/server/supabase-admin";
import { sha256 } from "../../../../../lib/dedupe";

async function validSignature(body:string,provided:string|null,secret:string){
  if(!provided)return false;const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body)));const expected=`sha256=${[...bytes].map((value)=>value.toString(16).padStart(2,"0")).join("")}`;
  if(expected.length!==provided.length)return false;let mismatch=0;for(let index=0;index<expected.length;index++)mismatch|=expected.charCodeAt(index)^provided.charCodeAt(index);return mismatch===0;
}

export async function POST(request:Request){
  const secret=process.env.GET_NOTES_WEBHOOK_SECRET;const workspaceId=process.env.GET_NOTES_WEBHOOK_WORKSPACE_ID;const knowledgeBaseId=process.env.GET_NOTES_KNOWLEDGE_BASE_ID ?? "webhook";
  if(!secret || !workspaceId)return Response.json({error:"Webhook 尚未配置"},{status:503});
  const body=await request.text();if(!await validSignature(body,request.headers.get("x-get-notes-signature"),secret))return Response.json({error:"签名无效"},{status:401});
  let payload:unknown;try{payload=JSON.parse(body)}catch{return Response.json({error:"JSON 无效"},{status:400})}
  const items=normalizeWebhookItems(payload);const deliveryId=request.headers.get("x-get-notes-delivery") ?? sha256(body);const admin=getSupabaseAdmin();
  const source=await ensureSource(admin,{workspaceId,type:"get_notes",externalId:knowledgeBaseId,name:"Get 笔记 · Webhook",metadata:{mode:"webhook",knowledgeBaseId}});const runId=await startSyncRun(admin,{workspaceId,sourceId:source.id});let normalized=0;
  try{for(const item of items){item.normalized.sourceMetadata={...item.normalized.sourceMetadata,deliveryId,knowledgeBaseId,provenance:"verified_live"};const content=await persistNormalizedContent(admin,{workspaceId,sourceId:source.id,sourceType:"get_notes",syncRunId:runId,raw:item.raw,normalized:item.normalized});normalized+=1;await enqueueJob(admin,{workspaceId,type:"analyze_competitor_content",idempotencyKey:`analyze_competitor_content:${content.id}`,payload:{contentId:content.id}});}await finishSyncRun(admin,{runId,sourceId:source.id,fetched:items.length,normalized,errors:0,metrics:{deliveryId}});return Response.json({ok:true,deliveryId,received:items.length,normalized});}
  catch(error){await finishSyncRun(admin,{runId,sourceId:source.id,fetched:items.length,normalized,errors:1,error:error instanceof Error?error.message:String(error)});return Response.json({error:error instanceof Error?error.message:"Webhook 处理失败"},{status:500});}
}
