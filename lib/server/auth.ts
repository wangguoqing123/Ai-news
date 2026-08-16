import { createClient } from "@supabase/supabase-js";

export type RequestContext = { mode:"demo";workspaceId:"demo";userId:"demo" } | { mode:"supabase";workspaceId:string;userId:string };

export async function requireRequestContext(request: Request): Promise<RequestContext> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return { mode:"demo",workspaceId:"demo",userId:"demo" };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if (!token) throw new Response(JSON.stringify({ error:"未登录" }),{ status:401,headers:{ "Content-Type":"application/json" } });
  const auth = createClient(url,anon); const { data,error } = await auth.auth.getUser(token);
  if (error || !data.user) throw new Response(JSON.stringify({ error:"登录已过期" }),{ status:401,headers:{ "Content-Type":"application/json" } });
  const admin = createClient(url,service,{ auth:{ persistSession:false } });
  const requested = request.headers.get("x-workspace-id");
  let query = admin.from("workspace_members").select("workspace_id").eq("user_id",data.user.id).limit(1);
  if (requested) query = query.eq("workspace_id",requested);
  const { data:member } = await query.single();
  if (!member) throw new Response(JSON.stringify({ error:"无权访问该工作区" }),{ status:403,headers:{ "Content-Type":"application/json" } });
  return { mode:"supabase",workspaceId:member.workspace_id,userId:data.user.id };
}
