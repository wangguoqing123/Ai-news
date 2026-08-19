import{z}from"zod";
import{requeueAnalysis}from"../../../../lib/services/analysis-queue";
import{requireRequestContext}from"../../../../lib/server/auth";
import{getSupabaseAdmin}from"../../../../lib/server/supabase-admin";

const schema=z.object({status:z.enum(["failed","dead_letter"]),contentId:z.string().uuid().optional(),clusterId:z.string().uuid().optional()});
export async function POST(request:Request){try{const context=await requireRequestContext(request);if(context.mode==="demo")return Response.json({error:"演示模式没有可重排任务"},{status:409});const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:"重排参数无效",issues:parsed.error.issues},{status:400});return Response.json({ok:true,...await requeueAnalysis(getSupabaseAdmin(),{workspaceId:context.workspaceId,...parsed.data})});}catch(error){if(error instanceof Response)return error;return Response.json({error:error instanceof Error?error.message:"任务重排失败"},{status:500});}}
