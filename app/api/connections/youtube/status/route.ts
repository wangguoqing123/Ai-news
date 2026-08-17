import { createClient } from "@supabase/supabase-js";
import { requireRequestContext } from "../../../../../lib/server/auth";

export async function GET(request: Request) {
  try {
    const context = await requireRequestContext(request);
    if (context.mode === "demo") return Response.json({ connected:false,status:"demo",subscriptionCount:0 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url,serviceKey,{ auth:{ persistSession:false } });
    const { data:connection,error } = await admin.from("source_connections").select("id,status,last_error,updated_at").eq("workspace_id",context.workspaceId).eq("type","youtube").maybeSingle();
    if (error) return Response.json({ error:"读取 YouTube 连接状态失败" },{ status:500 });
    if (!connection) return Response.json({ connected:false,status:"pending",subscriptionCount:0 });
    const { data:source } = await admin.from("sources").select("id,last_success_at").eq("workspace_id",context.workspaceId).eq("type","youtube").eq("external_id","subscriptions").maybeSingle();
    let subscriptionCount = 0;
    if (source) {
      const { count } = await admin.from("source_subscriptions").select("id",{ count:"exact",head:true }).eq("workspace_id",context.workspaceId).eq("source_id",source.id).eq("enabled",true);
      subscriptionCount = count ?? 0;
    }
    return Response.json({ connected:true,status:connection.status,subscriptionCount,lastSuccessAt:source?.last_success_at ?? connection.updated_at,lastError:connection.last_error });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error:error instanceof Error ? error.message : "读取连接状态失败" },{ status:500 });
  }
}
