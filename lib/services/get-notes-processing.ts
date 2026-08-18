import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueContentAnalysis } from "./analysis-queue";
import { enqueueJob } from "./ingest";

export async function enqueueGetNotesProcessing(admin:SupabaseClient,input:{workspaceId:string;contentId:string;contentHash:string;hasTranscript:boolean}) {
  const jobs=[];
  if(input.hasTranscript)jobs.push(await enqueueJob(admin,{workspaceId:input.workspaceId,type:"fetch_transcript",idempotencyKey:`fetch_transcript:get_notes_text:${input.contentId}:${input.contentHash}`,payload:{contentId:input.contentId,sourceType:"get_notes",contentHash:input.contentHash},priority:70}));
  jobs.push(await enqueueContentAnalysis(admin,{workspaceId:input.workspaceId,contentId:input.contentId,type:"analyze_competitor_content",contentHash:input.contentHash,priority:55}));
  return jobs;
}
