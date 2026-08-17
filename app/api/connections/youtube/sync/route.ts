import { createClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "../../../../../lib/security/crypto";
import { requireRequestContext } from "../../../../../lib/server/auth";
import { fetchYouTubeSubscriptions, refreshYouTubeAccessToken, type YouTubeOAuthTokens } from "../../../../../lib/youtube/api";
import { persistYouTubeSubscriptions } from "../../../../../lib/youtube/persistence";

export async function POST(request: Request) {
  try {
    const context = await requireRequestContext(request);
    if (context.mode === "demo") return Response.json({ ok:true,mode:"demo",subscriptionCount:0 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const encryptionSecret = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!encryptionSecret || !clientId || !clientSecret) return Response.json({ error:"YouTube OAuth 配置不完整" },{ status:503 });
    const admin = createClient(url,serviceKey,{ auth:{ persistSession:false } });
    const { data:connection,error } = await admin.from("source_connections").select("id,encrypted_config").eq("workspace_id",context.workspaceId).eq("type","youtube").maybeSingle();
    if (error || !connection?.encrypted_config) return Response.json({ error:"YouTube 尚未授权" },{ status:409 });
    let tokens = await decryptJson<YouTubeOAuthTokens>(connection.encrypted_config,encryptionSecret);
    if (!tokens.access_token || !tokens.expires_at || tokens.expires_at < Date.now()+60_000) {
      if (!tokens.refresh_token) return Response.json({ error:"YouTube 授权已失效，请重新授权" },{ status:401 });
      tokens = await refreshYouTubeAccessToken({ refreshToken:tokens.refresh_token,clientId,clientSecret });
      await admin.from("source_connections").update({ encrypted_config:await encryptJson(tokens,encryptionSecret),last_error:null }).eq("id",connection.id);
    }
    const subscriptions = await fetchYouTubeSubscriptions(tokens.access_token);
    const result = await persistYouTubeSubscriptions({ admin,workspaceId:context.workspaceId,connectionId:connection.id,subscriptions });
    await admin.from("source_connections").update({ status:"connected",last_error:null }).eq("id",connection.id);
    return Response.json({ ok:true,mode:"verified_live",subscriptionCount:result.count });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error:error instanceof Error ? error.message : "YouTube 同步失败" },{ status:502 });
  }
}
