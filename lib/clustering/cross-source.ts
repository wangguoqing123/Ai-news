import type{SupabaseClient}from"@supabase/supabase-js";
import{sha256}from"../dedupe";
import{enqueueTrendAnalysis}from"../services/analysis-queue";

const labels:Record<string,string>={openai:"OpenAI",chatgpt:"OpenAI",claude:"Claude",anthropic:"Anthropic",gemini:"Gemini",cursor:"Cursor","claude code":"Claude Code",codex:"Codex",mcp:"MCP",agent:"Agent",多智能体:"Agent",智能体:"Agent","ai 编程":"AI 编程","vibe coding":"Vibe Coding","ai视频":"AI 视频","ai 视频":"AI 视频",sora:"Sora",seedance:"Seedance","ai工作流":"AI 工作流","ai 工作流":"AI 工作流",内容自动化:"内容自动化","ai教程":"AI 教程","ai 教程":"AI 教程","ai学习":"AI 学习","ai 学习":"AI 学习",一人公司:"一人公司",效率工具:"效率工具",qwen:"Qwen / 千问",千问:"Qwen / 千问",deepseek:"DeepSeek",kimi:"Kimi"};

export function extractEntities(title:string){const lower=title.normalize("NFKC").toLowerCase();const found=new Set<string>();for(const[key,label]of Object.entries(labels)){if(key==="智能体"&&lower.includes("多智能体"))continue;if(lower.includes(key))found.add(label);}return[...found];}
export type TrendWindows={last24h:number;current7d:number;previous7d:number;baseline30d:number};
export function classifyTrendWindows(counts:TrendWindows,sourceCount:number){if(sourceCount<2||counts.baseline30d<2)return"isolated"as const;const baselineWeekly=counts.baseline30d/30*7;if(counts.current7d>0&&counts.previous7d===0&&counts.last24h>0)return"emerging"as const;if(counts.current7d>=2&&counts.current7d>=Math.max(counts.previous7d*1.4,baselineWeekly*1.25))return"rising"as const;if(counts.previous7d>=2&&counts.current7d<counts.previous7d*.7)return"declining"as const;return"stable"as const;}
function trendBasis(counts:TrendWindows){return`24 小时 ${counts.last24h} 条；最近 7 天 ${counts.current7d} 条；前一 7 天 ${counts.previous7d} 条；30 天基线 ${counts.baseline30d} 条。`;}

export async function clusterCrossSourceTopics(admin:SupabaseClient,workspaceId:string){
  const since30=new Date(Date.now()-30*86_400_000).toISOString();
  const{data,error}=await admin.from("content_items").select("id,title,published_at,source:sources!inner(type)").eq("workspace_id",workspaceId).gte("published_at",since30).is("duplicate_of_id",null);if(error)throw new Error(error.message);
  const groups=new Map<string,Array<{id:string;publishedAt:string;sourceType:string}>>();
  for(const item of data??[]){if(!item.published_at)continue;const source=item.source as unknown as{type:string};for(const entity of extractEntities(item.title))groups.set(entity,[...(groups.get(entity)??[]),{id:item.id,publishedAt:item.published_at,sourceType:source.type}]);}
  let clusters=0;
  for(const[title,items]of groups){
    const now=Date.now();const sourceCounts=Object.fromEntries([...new Set(items.map(item=>item.sourceType))].map(type=>[type,items.filter(item=>item.sourceType===type).length]));const counts:TrendWindows={last24h:items.filter(item=>Date.parse(item.publishedAt)>=now-86_400_000).length,current7d:items.filter(item=>Date.parse(item.publishedAt)>=now-7*86_400_000).length,previous7d:items.filter(item=>Date.parse(item.publishedAt)>=now-14*86_400_000&&Date.parse(item.publishedAt)<now-7*86_400_000).length,baseline30d:items.length};const status=classifyTrendWindows(counts,Object.keys(sourceCounts).length);if(status==="isolated")continue;
    const basis=trendBasis(counts);const summary=`${Object.keys(sourceCounts).join("、")} 共同出现。${basis}`;const inputHash=sha256(JSON.stringify({title,ids:items.map(item=>item.id).sort(),counts,sourceCounts}));const{data:existing,error:existingError}=await admin.from("trend_clusters").select("id,input_hash").eq("workspace_id",workspaceId).eq("title",title).maybeSingle();if(existingError)throw new Error(existingError.message);let trendId=existing?.id as string|undefined;
    if(trendId){const updated=await admin.from("trend_clusters").update({status,window_days:30,evidence_count:items.length,summary,window_counts:counts,source_counts:sourceCounts,trend_basis:basis,input_hash:inputHash}).eq("id",trendId);if(updated.error)throw new Error(updated.error.message);}else{const{data:created,error:createError}=await admin.from("trend_clusters").insert({workspace_id:workspaceId,title,status,window_days:30,evidence_count:items.length,summary,window_counts:counts,source_counts:sourceCounts,trend_basis:basis,input_hash:inputHash}).select("id").single();if(createError||!created)throw new Error(createError?.message??"创建交叉信号失败");trendId=created.id;}
    if(!trendId)throw new Error("跨来源主题 ID 缺失");const relation=await admin.from("trend_cluster_items").upsert(items.map(item=>({workspace_id:workspaceId,cluster_id:trendId,content_id:item.id})),{onConflict:"cluster_id,content_id"});if(relation.error)throw new Error(relation.error.message);if(existing?.input_hash!==inputHash)await enqueueTrendAnalysis(admin,{workspaceId,trendId,inputHash});clusters+=1;
  }
  return{candidates:groups.size,clusters};
}
