import type { SupabaseClient } from "@supabase/supabase-js";
import { clusterAIHotEvents } from "../clustering/events";
import { clusterCrossSourceTopics } from "../clustering/cross-source";
import { semanticEventDedupe } from "../clustering/semantic";
import { AIHotConnector } from "../connectors/aihot";
import { ensureDailyBrief } from "../daily-brief/generate";
import { ensureSource,finishSyncRun,persistNormalizedContent,startSyncRun } from "./ingest";

function todayInBeijing() { return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date()); }

export async function syncAIHot(admin:SupabaseClient,workspaceId:string,options:{ window?:"24h"|"7d";mode?:"selected"|"all";limit?:number }={}) {
  const source=await ensureSource(admin,{workspaceId,type:"aihot",externalId:"aihot",name:"AIHot",processingMode:"automatic_deep",metadata:{provenance:"verified_live",endpoint:"v1"}});
  const runId=await startSyncRun(admin,{workspaceId,sourceId:source.id});
  const connector=new AIHotConnector();
  let cursor:string|null=null,fetched=0,normalized=0,duplicates=0,pages=0;
  try {
    do {
      const page=await connector.fetchPage({config:{baseUrl:"https://aihot.virxact.com/api/v1",mode:options.mode ?? "selected",window:options.window ?? "24h",limit:options.limit ?? 50},cursor});
      fetched+=page.items.length;pages+=1;
      for (const raw of page.items) {
        const item=await persistNormalizedContent(admin,{workspaceId,sourceId:source.id,sourceType:"aihot",syncRunId:runId,raw,normalized:await connector.normalize(raw)});
        normalized+=1;if(item.duplicateOfId) duplicates+=1;
      }
      cursor=page.hasMore ? page.nextCursor ?? null : null;
    } while(cursor && pages<20);
    const now=new Date();const since=new Date(now.getTime()-(options.window === "7d" ? 7 : 1)*86_400_000).toISOString();
    const clustering=await clusterAIHotEvents(admin,workspaceId,{since,until:now.toISOString()});
    const semanticDedupe=await semanticEventDedupe(admin,workspaceId,{since,until:now.toISOString()});
    const crossSource=await clusterCrossSourceTopics(admin,workspaceId);
    await finishSyncRun(admin,{runId,sourceId:source.id,fetched,normalized,errors:0,metrics:{pages,duplicates,clustering,semanticDedupe,crossSource}});
    const brief=await ensureDailyBrief(admin,workspaceId,todayInBeijing());
    return {source:"aihot" as const,status:"verified_live" as const,fetched,normalized,duplicates,pages,clustering,semanticDedupe,crossSource,brief};
  } catch (error) {
    await finishSyncRun(admin,{runId,sourceId:source.id,fetched,normalized,errors:1,error:error instanceof Error ? error.message : String(error)});
    throw error;
  }
}
