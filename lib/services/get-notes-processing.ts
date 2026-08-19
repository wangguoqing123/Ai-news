import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueContentAnalysis } from "./analysis-queue";
import { enqueueTranscriptFetch } from "./transcript-queue";

export async function enqueueGetNotesProcessing(admin:SupabaseClient,input:{workspaceId:string;contentId:string;contentHash:string;hasTranscript:boolean}) {
  const jobs=[];
  if(input.hasTranscript)jobs.push(await enqueueTranscriptFetch(admin,{workspaceId:input.workspaceId,contentId:input.contentId,contentHash:input.contentHash,sourceType:"get_notes",priority:70}));
  jobs.push(await enqueueContentAnalysis(admin,{workspaceId:input.workspaceId,contentId:input.contentId,type:"analyze_competitor_content",contentHash:input.contentHash,priority:55}));
  return jobs;
}
