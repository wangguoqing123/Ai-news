import { requireRequestContext } from "../../../../lib/server/auth";
import { getSupabaseAdmin } from "../../../../lib/server/supabase-admin";
import { syncAIHot } from "../../../../lib/services/aihot-sync";
import { syncYouTubeChannels,syncYouTubeChannelVideos } from "../../../../lib/services/youtube-sync";
import { syncGetNotesApi } from "../../../../lib/services/get-notes-api-sync";

export async function POST(request:Request){
  try{
    const context=await requireRequestContext(request);if(context.mode==="demo")return Response.json({ok:true,mode:"demo",results:[]});
    const body=await request.json().catch(()=>({})) as {sources?:string[]};const sources=body.sources?.length?body.sources:["aihot","youtube"];
    const admin=getSupabaseAdmin();const results:Array<unknown>=[];
    if(sources.includes("aihot"))results.push(await syncAIHot(admin,context.workspaceId));
    if(sources.includes("youtube")){results.push(await syncYouTubeChannels(admin,context.workspaceId));results.push(await syncYouTubeChannelVideos(admin,context.workspaceId));}
    if(sources.includes("get_notes")){
      if(process.env.GET_NOTES_MODE==="api")results.push(await syncGetNotesApi(admin,context.workspaceId));
      else results.push({source:"get_notes",status:process.env.GET_NOTES_MODE==="webhook"?"webhook_waiting":"worker_required",message:"CLI 模式只在独立 Worker 中运行"});
    }
    return Response.json({ok:true,mode:"verified_live",results});
  }catch(error){if(error instanceof Response)return error;return Response.json({error:error instanceof Error?error.message:"同步失败"},{status:500});}
}
