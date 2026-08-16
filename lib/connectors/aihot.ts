import { z } from "zod";
import { normalizedContentSchema, type SourceConnector } from "./types";

export const aihotConfigSchema = z.object({
  baseUrl: z.string().url().default("https://aihot.virxact.com/api/v1"),
  mode: z.enum(["selected", "all"]).default("selected"),
  window: z.enum(["24h", "7d"]).default("24h"),
  limit: z.number().int().min(1).max(50).default(10),
});

export type AIHotConfig = z.infer<typeof aihotConfigSchema>;

const itemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  publicId: z.string().optional(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  discoveredAt: z.string().nullable().optional(),
  category: z.union([z.string(), z.object({ name: z.string().optional(), slug: z.string().optional() })]).nullable().optional(),
  source: z.object({ name: z.string().optional() }).nullable().optional(),
  links: z.object({ aihot: z.string().url().nullable().optional(), original: z.string().url().nullable().optional() }).default({}),
  tags: z.array(z.string()).optional(),
  score: z.number().nullable().optional(),
}).passthrough();

export type AIHotRawItem = z.infer<typeof itemSchema>;

export class AIHotConnector implements SourceConnector<AIHotConfig, AIHotRawItem> {
  readonly type = "aihot";

  async validateConfig(config: unknown) {
    const parsed = aihotConfigSchema.safeParse(config);
    return parsed.success ? { valid: true, errors: [] } : { valid: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  async testConnection(config: AIHotConfig) {
    try {
      const page = await this.fetchPage({ config: { ...config, limit: 1 } });
      return { ok: true, message: `连接成功，读取到 ${page.items.length} 条内容`, sample: page.items[0] };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "连接失败" };
    }
  }

  async fetchPage({ config, cursor }: { config: AIHotConfig; cursor?: string | null }) {
    const safe = aihotConfigSchema.parse(config);
    const url = new URL(`${safe.baseUrl.replace(/\/$/, "")}/items`);
    url.searchParams.set("mode", safe.mode);
    url.searchParams.set("window", safe.window);
    url.searchParams.set("limit", String(safe.limit));
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "signal-desk/1.0 (+personal-research-workspace)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`AIHot 返回 ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    const data = (payload.data ?? payload) as Record<string, unknown>;
    const candidates = (data.items ?? payload.items ?? []) as unknown[];
    const items = candidates.map((item) => itemSchema.parse(item));
    const nextCursor = typeof data.nextCursor === "string" ? data.nextCursor : typeof data.next_cursor === "string" ? data.next_cursor : null;
    const hasMore = Boolean(data.hasMore ?? data.has_more ?? nextCursor);
    return { items, nextCursor, hasMore };
  }

  async normalize(raw: AIHotRawItem) {
    const parsed = itemSchema.parse(raw);
    const category = typeof parsed.category === "string" ? parsed.category : parsed.category?.name ?? parsed.category?.slug;
    return normalizedContentSchema.parse({
      externalId: parsed.publicId ?? parsed.id ?? parsed.links.aihot ?? parsed.title,
      contentType: "article",
      title: parsed.title,
      summary: parsed.summary ?? null,
      body: null,
      author: parsed.source?.name ?? null,
      canonicalUrl: parsed.links.original ?? parsed.links.aihot ?? null,
      publishedAt: parsed.publishedAt ?? parsed.discoveredAt ?? null,
      updatedAt: null,
      language: "zh-CN",
      durationSeconds: null,
      thumbnailUrl: null,
      tags: [...(parsed.tags ?? []), ...(category ? [category] : [])],
      metrics: { editorialScore: parsed.score ?? null },
      sourceMetadata: { aihotUrl: parsed.links.aihot ?? null, provenance: "verified_live" },
    });
  }
}
