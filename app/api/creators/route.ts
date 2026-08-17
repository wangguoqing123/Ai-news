import type { LearningRecommendation } from "../../../lib/domain/signal-desk";
import { readCreatorItems } from "../../../lib/repositories/creators";
import { requireRequestContext } from "../../../lib/server/auth";
import { getSupabaseAdmin } from "../../../lib/server/supabase-admin";

export async function GET(request:Request){try{const context=await requireRequestContext(request);if(context.mode==="demo")return Response.json({mode:"demo",items:[]});const params=new URL(request.url).searchParams;const recommendation=params.get("recommendation") as LearningRecommendation|null;const items=await readCreatorItems(getSupabaseAdmin(),context.workspaceId,{date:params.get("date")??undefined,days:Number(params.get("days")??7),source:params.get("source")??undefined,recommendation:recommendation??undefined,sort:params.get("sort")==="published"?"published":"recommended"});return Response.json({mode:"live",items});}catch(error){if(error instanceof Response)return error;return Response.json({error:error instanceof Error?error.message:"读取博主动态失败"},{status:500})}}
