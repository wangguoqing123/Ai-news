import{z}from"zod";
import{requireRequestContext}from"../../../../../lib/server/auth";
import{getSupabaseAdmin}from"../../../../../lib/server/supabase-admin";
import{readProcessingRequest,requestDeepProcessing}from"../../../../../lib/services/processing-requests";

const schema=z.object({mode:z.literal("deep")});

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const context=await requireRequestContext(request);if(context.mode==="demo")return Response.json({error:"演示模式不能创建真实深度处理任务"},{status:409});const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:"处理模式无效",issues:parsed.error.issues},{status:400});const{id}=await params;const result=await requestDeepProcessing(getSupabaseAdmin(),{workspaceId:context.workspaceId,contentId:id,requestedBy:context.userId});return Response.json({ok:true,requestId:result.request.id,status:result.created?"queued":result.request.status,jobs:result.jobs,created:result.created},{status:202});}catch(error){if(error instanceof Response)return error;return Response.json({error:error instanceof Error?error.message:"创建深度处理任务失败"},{status:500});}}

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const context=await requireRequestContext(request);if(context.mode==="demo")return Response.json({mode:"demo",request:null});const{id}=await params;return Response.json({mode:"live",request:await readProcessingRequest(getSupabaseAdmin(),context.workspaceId,id)});}catch(error){if(error instanceof Response)return error;return Response.json({error:error instanceof Error?error.message:"读取深度处理状态失败"},{status:500});}}
