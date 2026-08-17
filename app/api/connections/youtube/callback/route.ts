import { createClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson, verifyState } from "../../../../../lib/security/crypto";
import { fetchYouTubeSubscriptions, type YouTubeOAuthTokens } from "../../../../../lib/youtube/api";
import { persistYouTubeSubscriptions } from "../../../../../lib/youtube/persistence";

type OAuthState = { userId:string; workspaceId:string; nonce:string; exp:number };

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const oauthError = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("signal_youtube_state="))?.split("=").slice(1).join("=");
  const clientId = process.env.YOUTUBE_CLIENT_ID; const clientSecret = process.env.YOUTUBE_CLIENT_SECRET; const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
  const stateSecret = process.env.OAUTH_STATE_SECRET ?? process.env.OAUTH_TOKEN_ENCRYPTION_KEY; const encryptionSecret = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (oauthError) return Response.json({ error:`Google OAuth 未完成：${oauthError}` },{ status:400 });
  if (!code || !state || !cookieState || state !== cookieState || !clientId || !clientSecret || !redirectUri || !stateSecret || !encryptionSecret || !supabaseUrl || !serviceKey) return Response.json({ error:"OAuth 回调无效或部署配置不完整" },{ status:400 });
  const verified = await verifyState<OAuthState>(state,stateSecret);
  if (!verified || verified.exp < Date.now()) return Response.json({ error:"OAuth 状态已过期" },{ status:400 });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token",{ method:"POST",headers:{ "Content-Type":"application/x-www-form-urlencoded" },body:new URLSearchParams({ code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:"authorization_code" }),signal:AbortSignal.timeout(20_000) });
  if (!tokenResponse.ok) return Response.json({ error:`Google Token 交换失败 (${tokenResponse.status})` },{ status:502 });
  const tokens = await tokenResponse.json() as YouTubeOAuthTokens;
  const admin = createClient(supabaseUrl,serviceKey,{ auth:{ persistSession:false } });
  let refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    const { data:existing } = await admin.from("source_connections").select("encrypted_config").eq("workspace_id",verified.workspaceId).eq("type","youtube").maybeSingle();
    if (existing?.encrypted_config) {
      try { refreshToken = (await decryptJson<YouTubeOAuthTokens>(existing.encrypted_config,encryptionSecret)).refresh_token; } catch { /* a new consent can replace an unreadable legacy token */ }
    }
  }
  const storedTokens: YouTubeOAuthTokens = { ...tokens,refresh_token:refreshToken,expires_at:Date.now()+(tokens.expires_in ?? 3600)*1000 };
  const encrypted = await encryptJson(storedTokens,encryptionSecret);
  const { data:connection,error } = await admin.from("source_connections").upsert({ workspace_id:verified.workspaceId,type:"youtube",name:"YouTube 订阅",status:"connected",encrypted_config:encrypted,config_version:1,last_error:null },{ onConflict:"workspace_id,type" }).select("id").single();
  if (error || !connection) return Response.json({ error:"保存 YouTube 授权失败" },{ status:500 });

  let subscriptionCount = 0;
  let warning = false;
  try {
    const subscriptions = await fetchYouTubeSubscriptions(tokens.access_token);
    subscriptionCount = (await persistYouTubeSubscriptions({ admin,workspaceId:verified.workspaceId,connectionId:connection.id,subscriptions })).count;
  } catch (importError) {
    warning = true;
    await admin.from("source_connections").update({ last_error:importError instanceof Error ? importError.message.slice(0,500) : "YouTube 订阅导入失败" }).eq("id",connection.id);
  }
  const location = new URL(`/?connected=youtube&subscriptions=${subscriptionCount}${warning ? "&warning=sync" : ""}`,requestUrl.origin).toString();
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return new Response(null,{ status:302,headers:{ Location:location,"Set-Cookie":`signal_youtube_state=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0` } });
}
