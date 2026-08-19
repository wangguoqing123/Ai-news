import{execFile}from"node:child_process";
import{promisify}from"node:util";
import{z}from"zod";
import type{AIProvider}from"../ai/provider";
import{providerHealthSchema}from"../ai/schemas";

const run=promisify(execFile);
export type HealthState={status:"healthy"|"unhealthy"|"not_configured";checkedAt:string;detail:string};
export type WorkerDependencyHealth={database:HealthState;aiProvider:HealthState;transcriptProvider:HealthState;getNotes:HealthState;keychain:HealthState};
const healthy=(detail:string):HealthState=>({status:"healthy",checkedAt:new Date().toISOString(),detail});
const unhealthy=(detail:string):HealthState=>({status:"unhealthy",checkedAt:new Date().toISOString(),detail});
const missing=(detail:string):HealthState=>({status:"not_configured",checkedAt:new Date().toISOString(),detail});
async function command(path:string,args:string[],label:string){try{await run(path,args,{timeout:30_000,maxBuffer:64_000,env:process.env});return healthy(`${label} 可用`);}catch(error){return unhealthy(`${label} 不可用：${error instanceof Error?error.message.split("\n")[0]:String(error)}`);}}

async function aiHealth(provider:AIProvider|null){if(!provider)return missing("AI Provider 未配置");if(provider.name==="codex_cli"){const path=process.env.CODEX_CLI_PATH??"codex";const version=await command(path,["--version"],"Codex CLI");if(version.status!=="healthy")return version;const login=await command(path,["login","status"],"Codex 登录");if(login.status!=="healthy")return login;}try{await provider.generateStructuredDetailed({schema:providerHealthSchema,schemaName:"provider_health",system:"这是健康检查。只返回符合 schema 的 JSON。",prompt:JSON.stringify({ok:true}),temperature:0});return healthy(`${provider.name} 结构化请求成功`);}catch(error){return unhealthy(`AI 最小结构化请求失败：${error instanceof Error?error.message:String(error)}`);}}

async function transcriptHealth(){const configured=(process.env.TRANSCRIPT_PROVIDER_CHAIN??process.env.TRANSCRIPT_PROVIDER??"").split(",").map(item=>item.trim()).filter(Boolean);if(!configured.length)return missing("Transcript Provider 未配置");const results:HealthState[]=[];if(configured.includes("ingested_text"))results.push(healthy("ingested_text 仅用于 Get 笔记正文"));if(configured.includes("yt_dlp"))results.push(await command(process.env.YT_DLP_PATH??"yt-dlp",["--version"],"yt-dlp"));if(configured.includes("api")){if(!process.env.TRANSCRIPT_API_BASE_URL||!process.env.TRANSCRIPT_API_KEY)results.push(unhealthy("Transcript API URL 或 Key 缺失"));else try{const response=await fetch(process.env.TRANSCRIPT_API_BASE_URL,{method:"HEAD",headers:{Authorization:`Bearer ${process.env.TRANSCRIPT_API_KEY}`},signal:AbortSignal.timeout(10_000)});results.push(response.status<500?healthy(`Transcript API 响应 ${response.status}`):unhealthy(`Transcript API 响应 ${response.status}`));}catch(error){results.push(unhealthy(`Transcript API 请求失败：${error instanceof Error?error.message:String(error)}`));}}return results.some(item=>item.status==="healthy")?healthy(results.map(item=>item.detail).join("；")):unhealthy(results.map(item=>item.detail).join("；"));}

async function getNotesHealth(){if(process.env.GET_NOTES_MODE!=="cli")return process.env.GET_NOTES_MODE==="api"?healthy("Get 笔记 API 模式已配置"):missing("Get 笔记未启用");return command(process.env.GETNOTE_CLI_PATH??"getnote",["auth","status","-o","json"],"Get 笔记 CLI 登录");}

async function keychainHealth(){if(process.env.DATABASE_CREDENTIAL_SOURCE!=="keychain")return healthy("数据库凭据已由运行环境注入");return command("security",["find-generic-password","-a","postgres","-s",process.env.DATABASE_KEYCHAIN_SERVICE??"signal-desk-supabase-db-jsdpfgjdrkveogofyoki"],"Keychain 数据库密码");}

export async function checkWorkerDependencies(input:{databaseCheck:()=>Promise<void>;provider:AIProvider|null}):Promise<WorkerDependencyHealth>{let database:HealthState;try{await input.databaseCheck();database=healthy("数据库连接成功");}catch(error){database=unhealthy(`数据库连接失败：${error instanceof Error?error.message:String(error)}`);}const[aiProvider,transcriptProvider,getNotes,keychain]=await Promise.all([aiHealth(input.provider),transcriptHealth(),getNotesHealth(),keychainHealth()]);return{database,aiProvider,transcriptProvider,getNotes,keychain};}

export function dependencyIsHealthy(health:WorkerDependencyHealth,type:"ai_provider"|"transcript_provider"){return type==="ai_provider"?health.aiProvider.status==="healthy":health.transcriptProvider.status==="healthy";}

export const healthStateSchema=z.object({status:z.enum(["healthy","unhealthy","not_configured"]),checkedAt:z.string(),detail:z.string()});
