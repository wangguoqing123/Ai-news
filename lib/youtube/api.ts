export type YouTubeOAuthTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
  token_type?: string;
};

export type YouTubeSubscription = {
  channelId: string;
  name: string;
  uploadsPlaylistId: string;
  iconUrl: string | null;
};

export type YouTubePlaylistVideo = {
  playlistItemId:string;
  videoId:string;
  publishedAt:string;
  title:string;
  description:string;
  channelId:string|null;
  channelTitle:string|null;
  thumbnailUrl:string|null;
};

export type YouTubeVideoDetail = {
  videoId:string;
  title:string;
  description:string;
  publishedAt:string;
  channelId:string;
  channelTitle:string;
  durationSeconds:number|null;
  thumbnailUrl:string|null;
  contentKind:"video"|"short"|"live";
  liveStatus:"none"|"upcoming"|"live"|"completed";
  defaultLanguage:string|null;
  chapters:Array<{ startSeconds:number;title:string }>;
  viewCount:number|null;
  likeCount:number|null;
  commentCount:number|null;
  availability:"public"|"unavailable";
};

type FetchLike = typeof fetch;

async function readGoogleJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const requestId = response.headers.get("x-guploader-uploadid") ?? response.headers.get("x-request-id");
    const payload=await response.json().catch(() => null) as { error?:{ errors?:Array<{ reason?:string }>;message?:string } }|null;
    const reason=payload?.error?.errors?.[0]?.reason ?? payload?.error?.message;
    throw new Error(`${label} 返回 ${response.status}${reason ? `：${reason}` : ""}${requestId ? ` (${requestId})` : ""}`);
  }
  return response.json() as Promise<T>;
}

export function parseYouTubeDuration(value:string|undefined):number|null {
  if (!value) return null;
  const match=/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return null;
  return Number(match[1] ?? 0)*86400+Number(match[2] ?? 0)*3600+Number(match[3] ?? 0)*60+Number(match[4] ?? 0);
}

export function parseYouTubeChapters(description:string) {
  const chapters:Array<{ startSeconds:number;title:string }>=[];
  for (const line of description.split(/\r?\n/)) {
    const match=/^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    chapters.push({ startSeconds:Number(match[1] ?? 0)*3600+Number(match[2])*60+Number(match[3]),title:match[4] });
  }
  return chapters.length>=2 ? chapters : [];
}

export async function fetchYouTubePlaylistPage(input:{ accessToken:string;uploadsPlaylistId:string;pageToken?:string|null;maxResults?:number;fetchImpl?:FetchLike }) {
  const fetchImpl=input.fetchImpl ?? fetch;
  const url=new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part","snippet,contentDetails,status");url.searchParams.set("playlistId",input.uploadsPlaylistId);url.searchParams.set("maxResults",String(input.maxResults ?? 50));
  if(input.pageToken)url.searchParams.set("pageToken",input.pageToken);
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${input.accessToken}`},signal:AbortSignal.timeout(20_000)});
  const payload=await readGoogleJson<{items?:Array<{id:string;snippet?:{publishedAt?:string;title?:string;description?:string;channelId?:string;channelTitle?:string;thumbnails?:Record<string,{url?:string}>;resourceId?:{videoId?:string}};contentDetails?:{videoId?:string;videoPublishedAt?:string}}>;nextPageToken?:string}>(response,"YouTube 上传列表读取");
  const items:YouTubePlaylistVideo[]=(payload.items ?? []).flatMap((item) => {
    const videoId=item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
    const publishedAt=item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt;
    if(!videoId || !publishedAt)return[];
    const thumbs=item.snippet?.thumbnails ?? {};
    return[{playlistItemId:item.id,videoId,publishedAt,title:item.snippet?.title ?? "不可用视频",description:item.snippet?.description ?? "",channelId:item.snippet?.channelId ?? null,channelTitle:item.snippet?.channelTitle ?? null,thumbnailUrl:thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null}];
  });
  return{items,nextPageToken:payload.nextPageToken ?? null,quotaUnits:1};
}

function numberOrNull(value:string|undefined){const parsed=value ? Number(value) : NaN;return Number.isFinite(parsed) ? parsed : null;}

export async function fetchYouTubeVideoDetails(accessToken:string,videoIds:string[],fetchImpl:FetchLike=fetch):Promise<Map<string,YouTubeVideoDetail>> {
  const details=new Map<string,YouTubeVideoDetail>();
  for(let index=0;index<videoIds.length;index+=50){
    const ids=videoIds.slice(index,index+50);if(!ids.length)continue;
    const url=new URL("https://www.googleapis.com/youtube/v3/videos");url.searchParams.set("part","snippet,contentDetails,status,statistics,liveStreamingDetails");url.searchParams.set("id",ids.join(","));url.searchParams.set("maxResults","50");
    const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(20_000)});
    const payload=await readGoogleJson<{items?:Array<{id:string;snippet:{publishedAt:string;channelId:string;title:string;description:string;channelTitle:string;defaultAudioLanguage?:string;defaultLanguage?:string;liveBroadcastContent?:string;thumbnails?:Record<string,{url?:string}>};contentDetails?:{duration?:string};status?:{privacyStatus?:string;uploadStatus?:string};statistics?:{viewCount?:string;likeCount?:string;commentCount?:string};liveStreamingDetails?:{actualStartTime?:string;actualEndTime?:string;scheduledStartTime?:string}}>}>(response,"YouTube 视频详情读取");
    for(const item of payload.items ?? []){
      const durationSeconds=parseYouTubeDuration(item.contentDetails?.duration);const live=item.snippet.liveBroadcastContent;const streaming=item.liveStreamingDetails;
      const liveStatus:YouTubeVideoDetail["liveStatus"]=live === "upcoming" ? "upcoming" : live === "live" ? "live" : streaming?.actualEndTime ? "completed" : "none";
      const contentKind:YouTubeVideoDetail["contentKind"]=liveStatus !== "none" ? "live" : (durationSeconds ?? 999)>0 && (durationSeconds ?? 999)<=60 || /#shorts\b/i.test(item.snippet.description) ? "short" : "video";
      const thumbs=item.snippet.thumbnails ?? {};
      details.set(item.id,{videoId:item.id,title:item.snippet.title,description:item.snippet.description,publishedAt:item.snippet.publishedAt,channelId:item.snippet.channelId,channelTitle:item.snippet.channelTitle,durationSeconds,thumbnailUrl:thumbs.maxres?.url ?? thumbs.standard?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null,contentKind,liveStatus,defaultLanguage:item.snippet.defaultAudioLanguage ?? item.snippet.defaultLanguage ?? null,chapters:parseYouTubeChapters(item.snippet.description),viewCount:numberOrNull(item.statistics?.viewCount),likeCount:numberOrNull(item.statistics?.likeCount),commentCount:numberOrNull(item.statistics?.commentCount),availability:item.status?.privacyStatus === "public" ? "public" : "unavailable"});
    }
    for(const missing of ids.filter((id)=>!details.has(id)))details.set(missing,{videoId:missing,title:"视频已删除或设为私密",description:"",publishedAt:new Date(0).toISOString(),channelId:"",channelTitle:"",durationSeconds:null,thumbnailUrl:null,contentKind:"video",liveStatus:"none",defaultLanguage:null,chapters:[],viewCount:null,likeCount:null,commentCount:null,availability:"unavailable"});
  }
  return details;
}

export async function refreshYouTubeAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}): Promise<YouTubeOAuthTokens> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      client_id:input.clientId,
      client_secret:input.clientSecret,
      refresh_token:input.refreshToken,
      grant_type:"refresh_token",
    }),
    signal:AbortSignal.timeout(20_000),
  });
  const payload = await readGoogleJson<YouTubeOAuthTokens>(response,"Google Token 刷新");
  return { ...payload,refresh_token:input.refreshToken,expires_at:Date.now()+(payload.expires_in ?? 3600)*1000 };
}

export async function fetchYouTubeSubscriptions(accessToken: string, fetchImpl: FetchLike = fetch): Promise<YouTubeSubscription[]> {
  const channelNames = new Map<string,{ name:string;iconUrl:string|null }>();
  let pageToken: string | null = null;
  let pageCount = 0;
  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/subscriptions");
    url.searchParams.set("part","snippet");
    url.searchParams.set("mine","true");
    url.searchParams.set("maxResults","50");
    if (pageToken) url.searchParams.set("pageToken",pageToken);
    const response = await fetchImpl(url,{ headers:{ Authorization:`Bearer ${accessToken}` },signal:AbortSignal.timeout(20_000) });
    const payload = await readGoogleJson<{
      items?: Array<{ snippet?: { title?:string;resourceId?:{ channelId?:string };thumbnails?:Record<string,{ url?:string }> } }>;
      nextPageToken?: string;
    }>(response,"YouTube 订阅读取");
    for (const item of payload.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (!channelId) continue;
      const thumbnails = item.snippet?.thumbnails ?? {};
      channelNames.set(channelId,{
        name:item.snippet?.title ?? channelId,
        iconUrl:thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null,
      });
    }
    pageToken = payload.nextPageToken ?? null;
    pageCount += 1;
  } while (pageToken && pageCount < 20);

  const channelIds = [...channelNames.keys()];
  const subscriptions: YouTubeSubscription[] = [];
  for (let index = 0; index < channelIds.length; index += 50) {
    const chunk = channelIds.slice(index,index+50);
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part","snippet,contentDetails");
    url.searchParams.set("id",chunk.join(","));
    url.searchParams.set("maxResults","50");
    const response = await fetchImpl(url,{ headers:{ Authorization:`Bearer ${accessToken}` },signal:AbortSignal.timeout(20_000) });
    const payload = await readGoogleJson<{
      items?: Array<{ id?:string;snippet?:{ title?:string;thumbnails?:Record<string,{ url?:string }> };contentDetails?:{ relatedPlaylists?:{ uploads?:string } } }>;
    }>(response,"YouTube 频道读取");
    for (const item of payload.items ?? []) {
      const channelId = item.id;
      const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
      if (!channelId || !uploadsPlaylistId) continue;
      const known = channelNames.get(channelId);
      const thumbnails = item.snippet?.thumbnails ?? {};
      subscriptions.push({
        channelId,
        name:item.snippet?.title ?? known?.name ?? channelId,
        uploadsPlaylistId,
        iconUrl:thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? known?.iconUrl ?? null,
      });
    }
  }
  return subscriptions.sort((a,b) => a.name.localeCompare(b.name,"zh-CN"));
}
