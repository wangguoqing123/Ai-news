import { spawn } from "node:child_process";
import { AIHotConnector } from "../lib/connectors/aihot";

function runGetNote(args: string[]): Promise<unknown> {
  return new Promise((resolve,reject) => {
    const child = spawn("getnote",args,{ stdio:["ignore","pipe","pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data",(chunk) => { stdout += String(chunk); });
    child.stderr.on("data",(chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Get Note timed out")); },15000);
    child.on("close",(code) => { clearTimeout(timer); if (code !== 0) reject(new Error(stderr.trim() || `Get Note exited ${code}`)); else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Get Note returned invalid JSON")); } } });
  });
}

const results: Array<Record<string,unknown>> = [];
try {
  const connector = new AIHotConnector();
  const page = await connector.fetchPage({ config:{ baseUrl:"https://aihot.virxact.com/api/v1",mode:"selected",window:"24h",limit:1 } });
  results.push({ source:"aihot",status:"verified_live",count:page.items.length });
} catch (error) { results.push({ source:"aihot",status:"failed",error:error instanceof Error ? error.message : String(error) }); }

try {
  const payload = await runGetNote(["kb","bloggers","J9o7AMeY","-o","json"]) as { data?: { bloggers?: unknown[] } };
  results.push({ source:"get_notes",status:"verified_live",knowledgeBase:"Ai 自媒体对标博主",bloggerCount:payload.data?.bloggers?.length ?? 0,credentials:"present_redacted" });
} catch (error) { results.push({ source:"get_notes",status:"failed",error:error instanceof Error ? error.message : String(error) }); }

results.push({ source:"youtube",status:process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET ? "configured_not_authorized" : "manual_verification_required" });
results.push({ source:"supabase",status:process.env.NEXT_PUBLIC_SUPABASE_URL ? "configured_not_migrated" : "manual_verification_required" });
console.log(JSON.stringify({ checkedAt:new Date().toISOString(),results },null,2));
