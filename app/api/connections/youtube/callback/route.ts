import { createClient } from "@supabase/supabase-js";
import { encryptJson, verifyState } from "../../../../../lib/security/crypto";

type OAuthState = { userId:string; workspaceId:string; nonce:string; exp:number };

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("signal_youtube_state="))?.split("=").slice(1).join("=");
  const clientId = process.env.YOUTUBE_CLIENT_ID; const clientSecret = process.env.YOUTUBE_CLIENT_SECRET; const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
  const stateSecret = process.env.OAUTH_STATE_SECRET ?? process.env.OAUTH_TOKEN_ENCRYPTION_KEY; const encryptionSecret = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!code || !state || !cookieState || state !== cookieState || !clientId || !clientSecret || !redirectUri || !stateSecret || !encryptionSecret || !supabaseUrl || !serviceKey) return Response.json({ error:"OAuth 回调无效或部署配置不完整" },{ status:400 });
  const verified = await verifyState<OAuthState>(state,stateSecret);
  if (!verified || verified.exp < Date.now()) return Response.json({ error:"OAuth 状态已过期" },{ status:400 });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token",{ method:"POST",headers:{ "Content-Type":"application/x-www-form-urlencoded" },body:new URLSearchParams({ code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:"authorization_code" }),signal:AbortSignal.timeout(20_000) });
  if (!tokenResponse.ok) return Response.json({ error:`Google Token 交换失败 (${tokenResponse.status})` },{ status:502 });
  const tokens = await tokenResponse.json() as { access_token:string;refresh_token?:string;expires_in:number;scope:string;token_type:string };
  const encrypted = await encryptJson({ ...tokens,expires_at:Date.now()+tokens.expires_in*1000 },encryptionSecret);
  const admin = createClient(supabaseUrl,serviceKey,{ auth:{ persistSession:false } });
  const { error } = await admin.from("source_connections").upsert({ workspace_id:verified.workspaceId,type:"youtube",name:"YouTube 订阅",status:"connected",encrypted_config:encrypted,config_version:1 },{ onConflict:"workspace_id,type" });
  if (error) return Response.json({ error:"保存 YouTube 授权失败" },{ status:500 });
  return new Response(null,{ status:302,headers:{ Location:"/?connected=youtube","Set-Cookie":"signal_youtube_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
}
