import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningRecommendation } from "../domain/signal-desk";
import { creatorFrom,type ContentRow } from "./today";

export async function readCreatorItems(admin:SupabaseClient,workspaceId:string,options:{date?:string;days?:number;source?:string;recommendation?:LearningRecommendation;sort?:"recommended"|"published"}={}){
  const end=options.date?new Date(`${options.date}T00:00:00+08:00`).getTime()+86_400_000:Date.now()+60_000;const start=options.date?end-86_400_000:end-(options.days??7)*86_400_000;
  const {data,error}=await admin.from("content_items").select("id,title,summary,author,canonical_url,published_at,duration_seconds,thumbnail_url,learning_score,topic_signal_score,processing_status,metadata,source:sources!inner(type,name,icon_url)").eq("workspace_id",workspaceId).in("sources.type",["youtube","get_notes"]).gte("published_at",new Date(start).toISOString()).lt("published_at",new Date(end).toISOString()).is("duplicate_of_id",null).order(options.sort==="recommended"?"learning_score":"published_at",{ascending:false,nullsFirst:false}).limit(250);
  if(error)throw new Error(error.message);let items=(data??[] as unknown as ContentRow[]).map((row)=>creatorFrom(row as unknown as ContentRow));
  if(options.source&&options.source!=="all")items=items.filter((item)=>item.sourceType===options.source||item.platform.toLowerCase()===options.source);
  if(options.recommendation)items=items.filter((item)=>item.recommendation===options.recommendation);
  return items;
}
