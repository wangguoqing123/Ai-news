import type { ContentAction } from "../../../../../lib/domain/signal-desk";
import { setContentAction } from "../../../../../lib/repositories/actions";
import { requireRequestContext } from "../../../../../lib/server/auth";
import { getSupabaseAdmin } from "../../../../../lib/server/supabase-admin";

const actions=new Set<ContentAction>(["read","saved","watch_later","ignored","not_interested","queued_learning"]);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const context=await requireRequestContext(request);if(context.mode==="demo")return Response.json({ok:true,mode:"demo"});const{id}=await params;const body=await request.json() as {action:ContentAction;value?:boolean};if(!actions.has(body.action))return Response.json({error:"操作无效"},{status:400});return Response.json({ok:true,...await setContentAction(getSupabaseAdmin(),{workspaceId:context.workspaceId,userId:context.userId,contentId:id,action:body.action,value:body.value!==false})});}catch(error){if(error instanceof Response)return error;return Response.json({error:error instanceof Error?error.message:"保存状态失败"},{status:500})}}
