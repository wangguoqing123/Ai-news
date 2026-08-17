import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyBriefEntry } from "../domain/signal-desk";

function range(date:string) { const start=new Date(`${date}T00:00:00+08:00`);return{start:start.toISOString(),end:new Date(start.getTime()+86_400_000).toISOString()}; }

export function buildDailyBriefEntries(input:{
  events:Array<{id:string;title:string;summary:string|null}>;
  trend?:{id:string;title:string;summary:string|null}|null;
  creator?:{id:string;title:string;summary:string|null}|null;
  topic?:{id:string;topic:string;differentiated_angle:string|null}|null;
}) {
  const entries:DailyBriefEntry[]=input.events.map((item,index) => ({ id:`event-${item.id}`,kind:"event",label:`重要事件 ${index+1}`,title:item.title,description:item.summary,href:`/ai-news?event=${item.id}` }));
  if(input.trend)entries.push({id:`trend-${input.trend.id}`,kind:"trend",label:"正在升温的主题",title:input.trend.title,description:input.trend.summary,href:`/ai-news?trend=${input.trend.id}`});
  if(input.creator)entries.push({ id:`creator-${input.creator.id}`,kind:"creator",label:"最值得看的博主内容",title:input.creator.title,description:input.creator.summary,href:`/learning/${input.creator.id}` });
  if(input.topic)entries.push({ id:`topic-${input.topic.id}`,kind:"topic",label:"选题机会",title:input.topic.topic,description:input.topic.differentiated_angle,href:`/learning?topic=${input.topic.id}` });
  return entries;
}

export async function ensureDailyBrief(admin:SupabaseClient,workspaceId:string,date:string,options:{ force?:boolean }={}) {
  const { data:existing,error:existingError }=await admin.from("daily_briefs").select("id,status").eq("workspace_id",workspaceId).eq("brief_date",date).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.status === "ready" && !options.force) return { id:existing.id,created:false };
  const { start,end }=range(date);
  const [eventsResult,creatorsResult,topicsResult,trendsResult]=await Promise.all([
    admin.from("event_clusters").select("id,title,summary,importance,topics").eq("workspace_id",workspaceId).gte("last_seen_at",start).lt("last_seen_at",end).eq("status","active").order("importance",{ascending:false}).limit(3),
    admin.from("content_items").select("id,title,summary,learning_score,metadata,source:sources!inner(type)").eq("workspace_id",workspaceId).in("sources.type",["youtube","get_notes"]).gte("published_at",start).lt("published_at",end).is("duplicate_of_id",null).order("learning_score",{ascending:false,nullsFirst:false}).limit(1),
    admin.from("topic_candidates").select("id,topic,differentiated_angle").eq("workspace_id",workspaceId).gte("created_at",start).lt("created_at",end).neq("status","abandoned").order("created_at",{ascending:false}).limit(1),
    admin.from("trend_clusters").select("id,title,summary,status").eq("workspace_id",workspaceId).in("status",["rising","emerging"]).order("evidence_count",{ascending:false}).limit(1),
  ]);
  for (const result of [eventsResult,creatorsResult,topicsResult,trendsResult]) if (result.error) throw new Error(result.error.message);
  const entries=buildDailyBriefEntries({events:eventsResult.data ?? [],trend:trendsResult.data?.[0],creator:creatorsResult.data?.[0],topic:topicsResult.data?.[0]});
  const payload={ workspace_id:workspaceId,brief_date:date,timezone:"Asia/Shanghai",status:"ready",summary:{ entries,generatedFrom:"database",generatedAt:new Date().toISOString() },completed_at:new Date().toISOString() };
  const { data,error }=await admin.from("daily_briefs").upsert(payload,{onConflict:"workspace_id,brief_date"}).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "生成简报失败");
  return { id:data.id as string,created:true,entries:entries.length };
}
