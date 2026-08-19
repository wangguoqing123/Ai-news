import { readFileSync } from "node:fs";
import { getSupabaseAdmin } from "../lib/server/supabase-admin";
import { syncAIHot } from "../lib/services/aihot-sync";
import { syncYouTubeChannels,syncYouTubeChannelVideos } from "../lib/services/youtube-sync";
import { syncGetNotesApi } from "../lib/services/get-notes-api-sync";
import { syncGetNotesCli } from "../lib/workers/get-notes-cli";

try{for(const line of readFileSync(".env.local","utf8").split(/\r?\n/)){const separator=line.indexOf("=");if(separator>0&&!process.env[line.slice(0,separator)])process.env[line.slice(0,separator)]=line.slice(separator+1)}}catch{/* hosted worker injects env */}

const requested=new Set((process.argv.find((value)=>value.startsWith("--sources="))?.split("=")[1]??"aihot,youtube,get_notes").split(","));
const admin=getSupabaseAdmin();const{data:workspace,error}=await admin.from("workspaces").select("id").order("created_at",{ascending:true}).limit(1).single();if(error||!workspace)throw new Error("没有可同步的工作区");
const results:Array<unknown>=[];
if(requested.has("aihot"))results.push(await syncAIHot(admin,workspace.id));
if(requested.has("youtube")){results.push(await syncYouTubeChannels(admin,workspace.id));results.push(await syncYouTubeChannelVideos(admin,workspace.id));}
if(requested.has("get_notes")){const mode=process.env.GET_NOTES_MODE??"cli";results.push(mode==="api"?await syncGetNotesApi(admin,workspace.id):await syncGetNotesCli(admin,workspace.id));}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
