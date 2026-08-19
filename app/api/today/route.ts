import { readToday } from "../../../lib/repositories/today";
import { ensureDailyBrief } from "../../../lib/daily-brief/generate";
import { requireRequestContext } from "../../../lib/server/auth";
import { getSupabaseAdmin } from "../../../lib/server/supabase-admin";

function todayInBeijing() { return new Intl.DateTimeFormat("en-CA",{ timeZone:"Asia/Shanghai" }).format(new Date()); }

export async function GET(request:Request) {
  try {
    const context = await requireRequestContext(request);
    const date = new URL(request.url).searchParams.get("date") ?? todayInBeijing();
    if (context.mode === "demo") return Response.json({ mode:"demo",date,windowLabel:"过去 24 小时",stats:{ importantEvents:0,creatorUpdates:0,deepLearning:0,topicOpportunities:0 },lastSyncedAt:null,briefStatus:"missing",briefGeneratedAt:null,pendingTaskCount:0,brief:[],events:[],creators:[],crossSignals:[],worker:null });
    const admin=getSupabaseAdmin();
    await ensureDailyBrief(admin,context.workspaceId,date);
    return Response.json(await readToday(admin,context.workspaceId,date));
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error:error instanceof Error ? error.message : "读取今日简报失败" },{ status:500 });
  }
}
