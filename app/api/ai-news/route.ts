import { readToday } from "../../../lib/repositories/today";
import { requireRequestContext } from "../../../lib/server/auth";
import { getSupabaseAdmin } from "../../../lib/server/supabase-admin";

function date(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date())}
export async function GET(request:Request){try{const context=await requireRequestContext(request);const selected=new URL(request.url).searchParams.get("date")??date();if(context.mode==="demo")return Response.json({mode:"demo",date:selected,events:[],crossSignals:[]});const today=await readToday(getSupabaseAdmin(),context.workspaceId,selected);return Response.json({mode:"live",date:selected,events:today.events,crossSignals:today.crossSignals});}catch(error){if(error instanceof Response)return error;return Response.json({error:error instanceof Error?error.message:"读取 AI 动态失败"},{status:500})}}
