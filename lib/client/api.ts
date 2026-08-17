import { getBrowserSupabase } from "../supabase/client";

export async function apiFetch<T>(path:string,init:RequestInit = {}):Promise<T> {
  const supabase = getBrowserSupabase();
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization",`Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type","application/json");
  const response = await fetch(path,{ ...init,headers });
  const payload = await response.json().catch(() => ({})) as T & { error?:string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败 (${response.status})`);
  return payload;
}
