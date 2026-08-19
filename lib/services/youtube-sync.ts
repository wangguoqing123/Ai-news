import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizedContentSchema } from "../connectors/types";
import { clusterCrossSourceTopics } from "../clustering/cross-source";
import { ensureDailyBrief } from "../daily-brief/generate";
import { decryptJson,encryptJson } from "../security/crypto";
import { fetchYouTubePlaylistPage,fetchYouTubeVideoDetails,refreshYouTubeAccessToken,type YouTubeOAuthTokens,type YouTubePlaylistVideo } from "../youtube/api";
import { fetchYouTubeSubscriptions } from "../youtube/api";
import { persistYouTubeSubscriptions } from "../youtube/persistence";
import { ensureSource,finishSyncRun,persistNormalizedContent,startSyncRun } from "./ingest";
import { enqueueMetadataProcessing } from "./metadata-processing";

function todayInBeijing(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date());}
function record(value:unknown):Record<string,unknown>{return value && typeof value === "object" ? value as Record<string,unknown> : {};}
export function videosAfterCursor(items:YouTubePlaylistVideo[],since:string){return items.filter((item)=>item.publishedAt>since);}

export async function getYouTubeAccess(admin:SupabaseClient,workspaceId:string){
  const encryptionSecret=process.env.OAUTH_TOKEN_ENCRYPTION_KEY;const clientId=process.env.YOUTUBE_CLIENT_ID;const clientSecret=process.env.YOUTUBE_CLIENT_SECRET;
  if(!encryptionSecret || !clientId || !clientSecret)throw new Error("YouTube OAuth 配置不完整");
  const {data:connection,error}=await admin.from("source_connections").select("id,encrypted_config,status").eq("workspace_id",workspaceId).eq("type","youtube").maybeSingle();
  if(error || !connection?.encrypted_config)throw new Error("YouTube 尚未授权");
  let tokens=await decryptJson<YouTubeOAuthTokens>(connection.encrypted_config,encryptionSecret);
  if(!tokens.access_token || !tokens.expires_at || tokens.expires_at<Date.now()+60_000){
    if(!tokens.refresh_token)throw new Error("YouTube 授权已过期，请重新授权");
    tokens=await refreshYouTubeAccessToken({refreshToken:tokens.refresh_token,clientId,clientSecret});
    const {error:updateError}=await admin.from("source_connections").update({encrypted_config:await encryptJson(tokens,encryptionSecret),status:"connected",last_error:null}).eq("id",connection.id);
    if(updateError)throw new Error(updateError.message);
  }
  return{connectionId:connection.id as string,token:tokens.access_token};
}

export async function syncYouTubeChannels(admin:SupabaseClient,workspaceId:string){
  const auth=await getYouTubeAccess(admin,workspaceId);const subscriptions=await fetchYouTubeSubscriptions(auth.token);
  const result=await persistYouTubeSubscriptions({admin,workspaceId,connectionId:auth.connectionId,subscriptions});
  return{source:"youtube" as const,status:"verified_live" as const,subscriptionCount:result.count};
}

export async function syncYouTubeChannelVideos(admin:SupabaseClient,workspaceId:string,options:{initialDays?:number;maxPagesPerChannel?:number;channelIds?:string[]}={},progress:((metrics:Record<string,unknown>)=>Promise<void>)=async()=>{}){
  const auth=await getYouTubeAccess(admin,workspaceId);
  const source=await ensureSource(admin,{workspaceId,type:"youtube",externalId:"subscriptions",name:"YouTube 订阅",connectionId:auth.connectionId,processingMode:"metadata_only",metadata:{syncMode:"uploads_playlist"}});
  const runId=await startSyncRun(admin,{workspaceId,sourceId:source.id});
  let subscriptionQuery=admin.from("source_subscriptions").select("id,external_id,name,metadata").eq("workspace_id",workspaceId).eq("source_id",source.id).eq("enabled",true).eq("muted",false);if(options.channelIds?.length)subscriptionQuery=subscriptionQuery.in("external_id",options.channelIds);const {data:subscriptions,error:subscriptionsError}=await subscriptionQuery;
  if(subscriptionsError)throw new Error(subscriptionsError.message);
  let fetched=0,normalized=0,duplicates=0,quotaUnits=0,channels=0,unavailable=0;
  const failures:Array<{channel:string;error:string}>=[];
  try{
    const totalChannels=subscriptions?.length??0;let processedChannels=0;for(const subscription of subscriptions ?? []){
      await progress({phase:"youtube_channels",currentChannel:subscription.name,processedChannels,totalChannels,discoveredVideos:fetched,writtenVideos:normalized,apiQuota:quotaUnits});
      const metadata=record(subscription.metadata);const uploadsPlaylistId=typeof metadata.uploadsPlaylistId === "string" ? metadata.uploadsPlaylistId : null;
      if(!uploadsPlaylistId){failures.push({channel:subscription.name,error:"缺少 uploads playlist"});processedChannels+=1;await progress({phase:"youtube_channels",currentChannel:subscription.name,processedChannels,totalChannels,discoveredVideos:fetched,writtenVideos:normalized,apiQuota:quotaUnits});continue;}
      channels+=1;
      const fallbackSince=new Date(Date.now()-(options.initialDays ?? 7)*86_400_000).toISOString();
      const since=typeof metadata.lastVideoPublishedAt === "string" ? metadata.lastVideoPublishedAt : fallbackSince;
      let pageToken:string|null=null,pages=0,done=false;const playlistItems:YouTubePlaylistVideo[]=[];
      try{
        do{
          const page=await fetchYouTubePlaylistPage({accessToken:auth.token,uploadsPlaylistId,pageToken});quotaUnits+=page.quotaUnits;pages+=1;
          const fresh=videosAfterCursor(page.items,since);playlistItems.push(...fresh);fetched+=fresh.length;
          if(page.items.some((item)=>item.publishedAt<=since) || !page.nextPageToken){done=true;pageToken=null;}else pageToken=page.nextPageToken;
        }while(!done && pageToken && pages<(options.maxPagesPerChannel ?? 5));
        const details=await fetchYouTubeVideoDetails(auth.token,playlistItems.map((item)=>item.videoId));if(playlistItems.length)quotaUnits+=Math.ceil(playlistItems.length/50);
        for(const item of playlistItems){
          const detail=details.get(item.videoId);if(!detail)continue;
          if(detail.availability === "unavailable")unavailable+=1;
          const publishedAt=detail.publishedAt === new Date(0).toISOString() ? item.publishedAt : detail.publishedAt;
          const title=detail.availability === "unavailable" ? item.title : detail.title;
          const description=detail.availability === "unavailable" ? item.description : detail.description;
          const normalizedItem=normalizedContentSchema.parse({externalId:item.videoId,contentType:detail.contentKind,title,summary:description ? description.slice(0,800) : null,body:description || null,author:detail.channelTitle || subscription.name,canonicalUrl:`https://www.youtube.com/watch?v=${item.videoId}`,publishedAt,updatedAt:null,language:detail.defaultLanguage,durationSeconds:detail.durationSeconds,thumbnailUrl:detail.thumbnailUrl ?? item.thumbnailUrl,tags:[detail.contentKind],metrics:{views:detail.viewCount,likes:detail.likeCount,comments:detail.commentCount},sourceMetadata:{playlistItemId:item.playlistItemId,channelId:detail.channelId || subscription.external_id,creatorAvatarUrl:metadata.iconUrl ?? null,contentKind:detail.contentKind,liveStatus:detail.liveStatus,availability:detail.availability,chapters:detail.chapters,hasTranscript:false,transcriptStatus:"not_requested",translationStatus:"translating",metadataClassificationStatus:"pending",interactionAvailable:detail.viewCount!==null,platform:"youtube",provenance:"verified_live"}});
          let persisted;try{persisted=await persistNormalizedContent(admin,{workspaceId,sourceId:source.id,sourceType:"youtube",syncRunId:runId,raw:{playlist:item,video:detail},normalized:normalizedItem})}catch(error){throw new Error(`视频 ${item.videoId} 写入失败：${error instanceof Error?error.message:String(error)}`)}normalized+=1;if(persisted.duplicateOfId)duplicates+=1;
          if(detail.availability === "public"&&persisted.shouldAnalyze)await enqueueMetadataProcessing(admin,{workspaceId,contentId:persisted.id,materialContentHash:persisted.materialContentHash,priority:95});
        }
        const latest=playlistItems.map((item)=>item.publishedAt).sort().at(-1) ?? since;
        const {error:updateError}=await admin.from("source_subscriptions").update({metadata:{...metadata,lastVideoPublishedAt:latest,lastVideoId:playlistItems.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))[0]?.videoId ?? metadata.lastVideoId,lastSyncAt:new Date().toISOString(),lastSyncStatus:"succeeded",quotaUnits}}).eq("id",subscription.id);
        if(updateError)throw new Error(updateError.message);
      }catch(error){
        failures.push({channel:subscription.name,error:error instanceof Error ? error.message : String(error)});
        await admin.from("source_subscriptions").update({metadata:{...metadata,lastSyncAt:new Date().toISOString(),lastSyncStatus:"failed",lastSyncError:error instanceof Error ? error.message.slice(0,300) : String(error).slice(0,300)}}).eq("id",subscription.id);
      }finally{processedChannels+=1;await progress({phase:"youtube_channels",currentChannel:subscription.name,processedChannels,totalChannels,discoveredVideos:fetched,writtenVideos:normalized,apiQuota:quotaUnits});}
    }
    const crossSource=await clusterCrossSourceTopics(admin,workspaceId);
    await finishSyncRun(admin,{runId,sourceId:source.id,fetched,normalized,errors:failures.length,metrics:{channels,duplicates,quotaUnits,unavailable,failures,crossSource}});
    const brief=await ensureDailyBrief(admin,workspaceId,todayInBeijing());
    return{source:"youtube" as const,status:failures.length ? "partial_success" as const : "verified_live" as const,channels,fetched,normalized,duplicates,unavailable,quotaUnits,failures,crossSource,brief};
  }catch(error){await finishSyncRun(admin,{runId,sourceId:source.id,fetched,normalized,errors:failures.length+1,error:error instanceof Error ? error.message : String(error),metrics:{channels,duplicates,quotaUnits,unavailable,failures}});throw error;}
}
