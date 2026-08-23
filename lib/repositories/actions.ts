import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentAction } from "../domain/signal-desk";

const fields:Record<ContentAction,string>={read:"isRead",saved:"isSaved",watch_later:"watchLater",ignored:"isIgnored",not_interested:"notInterested",queued_learning:"queuedLearning"};
const columns:Record<ContentAction,string>={read:"is_read",saved:"is_saved",watch_later:"watch_later",ignored:"is_ignored",not_interested:"not_interested",queued_learning:"queued_learning"};
function record(value:unknown):Record<string,unknown>{return value&&typeof value==="object"?value as Record<string,unknown>:{};}

export async function setContentAction(admin:SupabaseClient,input:{workspaceId:string;userId:string;contentId:string;action:ContentAction;value:boolean}){
  const {data,error}=await admin.from("content_items").select("metadata,status").eq("workspace_id",input.workspaceId).eq("id",input.contentId).single();if(error||!data)throw new Error(error?.message??"内容不存在");
  const metadata=record(data.metadata);const userState={...record(metadata.userState),[fields[input.action]]:input.value};
  const status=userState.isIgnored?"ignored":userState.queuedLearning?"queued_learning":userState.isSaved?"saved":userState.isRead?"skimmed":"unread";
  const update=await admin.from("content_items").update({metadata:{...metadata,userState},status}).eq("id",input.contentId);if(update.error)throw new Error(update.error.message);
  const stateRow={workspace_id:input.workspaceId,user_id:input.userId,content_id:input.contentId,[columns[input.action]]:input.value};const stored=await admin.from("content_user_states").upsert(stateRow,{onConflict:"user_id,content_id"});if(stored.error&&stored.error.code!=="42P01")throw new Error(stored.error.message);
  const feedback=await admin.from("feedback_events").insert({workspace_id:input.workspaceId,event_type:input.value?input.action:`undo_${input.action}`,entity_type:"content",entity_id:input.contentId,metadata:{value:input.value}});if(feedback.error)throw new Error(feedback.error.message);
  if(input.action==="queued_learning"&&input.value){const{data:session}=await admin.from("learning_sessions").select("id").eq("workspace_id",input.workspaceId).eq("content_id",input.contentId).neq("status","completed").order("created_at",{ascending:false}).limit(1).maybeSingle();if(!session){const created=await admin.from("learning_sessions").insert({workspace_id:input.workspaceId,content_id:input.contentId,goal:"理解核心观点并完成一次实践",status:"queued"});if(created.error)throw new Error(created.error.message)}}
  return{contentId:input.contentId,action:input.action,value:input.value,state:userState,status};
}
