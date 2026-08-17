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

type FetchLike = typeof fetch;

async function readGoogleJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const requestId = response.headers.get("x-guploader-uploadid") ?? response.headers.get("x-request-id");
    throw new Error(`${label} 返回 ${response.status}${requestId ? ` (${requestId})` : ""}`);
  }
  return response.json() as Promise<T>;
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
