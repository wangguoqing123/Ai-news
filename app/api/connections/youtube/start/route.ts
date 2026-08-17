import { createClient } from "@supabase/supabase-js";
import { signState } from "../../../../../lib/security/crypto";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
  const stateSecret = process.env.OAUTH_STATE_SECRET ?? process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!clientId || !redirectUri || !stateSecret || !supabaseUrl || !anonKey || !serviceKey) return Response.json({ error:"YouTube OAuth 尚未完成部署配置" },{ status:503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if (!token) return Response.json({ error:"未登录" },{ status:401 });
  const authClient = createClient(supabaseUrl,anonKey);
  const { data:userData, error:userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error:"登录已过期" },{ status:401 });
  const admin = createClient(supabaseUrl,serviceKey,{ auth:{ persistSession:false } });
  const { data:member } = await admin.from("workspace_members").select("workspace_id").eq("user_id",userData.user.id).limit(1).single();
  if (!member) return Response.json({ error:"找不到个人工作区" },{ status:403 });
  const state = await signState({ userId:userData.user.id,workspaceId:member.workspace_id,nonce:crypto.randomUUID(),exp:Date.now()+10*60_000 },stateSecret);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id",clientId); url.searchParams.set("redirect_uri",redirectUri); url.searchParams.set("response_type","code");
  url.searchParams.set("scope","https://www.googleapis.com/auth/youtube.readonly"); url.searchParams.set("access_type","offline"); url.searchParams.set("prompt","consent"); url.searchParams.set("state",state);
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return Response.json({ url:url.toString() },{ headers:{ "Set-Cookie":`signal_youtube_state=${state}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=600` } });
}
