import { z } from "zod";
import { normalizedContentSchema, type SourceConnector } from "./types";

export const youtubeConfigSchema = z.object({
  accessToken: z.string().min(1),
  uploadsPlaylistId: z.string().min(1),
  maxResults: z.number().int().min(1).max(50).default(25),
});

type YouTubeConfig = z.infer<typeof youtubeConfigSchema>;
type YouTubePlaylistItem = {
  id: string;
  snippet: { publishedAt: string; title: string; description: string; resourceId: { videoId: string }; channelTitle?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
};

export class YouTubeConnector implements SourceConnector<YouTubeConfig, YouTubePlaylistItem> {
  readonly type = "youtube";
  async validateConfig(config: unknown) {
    const result = youtubeConfigSchema.safeParse(config);
    return result.success ? { valid: true, errors: [] } : { valid: false, errors: result.error.issues.map((issue) => issue.message) };
  }
  async testConnection(config: YouTubeConfig) {
    try {
      const page = await this.fetchPage({ config: { ...config, maxResults: 1 } });
      return { ok: true, message: `YouTube 只读连接成功，读取到 ${page.items.length} 条视频` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "连接失败" };
    }
  }
  async fetchPage({ config, cursor }: { config: YouTubeConfig; cursor?: string | null }) {
    const safe = youtubeConfigSchema.parse(config);
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", safe.uploadsPlaylistId);
    url.searchParams.set("maxResults", String(safe.maxResults));
    if (cursor) url.searchParams.set("pageToken", cursor);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${safe.accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`YouTube 返回 ${response.status}`);
    const payload = await response.json() as { items?: YouTubePlaylistItem[]; nextPageToken?: string };
    return { items: payload.items ?? [], nextCursor: payload.nextPageToken ?? null, hasMore: Boolean(payload.nextPageToken) };
  }
  async normalize(raw: YouTubePlaylistItem) {
    const videoId = raw.contentDetails?.videoId ?? raw.snippet.resourceId.videoId;
    return normalizedContentSchema.parse({
      externalId: videoId,
      contentType: "video",
      title: raw.snippet.title,
      summary: raw.snippet.description,
      body: null,
      author: raw.snippet.channelTitle ?? null,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: raw.contentDetails?.videoPublishedAt ?? raw.snippet.publishedAt,
      updatedAt: null,
      language: null,
      durationSeconds: null,
      thumbnailUrl: raw.snippet.thumbnails?.high?.url ?? raw.snippet.thumbnails?.medium?.url ?? null,
      tags: [],
      metrics: {},
      sourceMetadata: { playlistItemId: raw.id },
    });
  }
}
