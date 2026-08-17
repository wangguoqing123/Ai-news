import { z } from "zod";
import { normalizedContentSchema, type NormalizedContent, type SourceConnector } from "./types";

export const fieldMappingSchema = z.object({
  itemsPath: z.string().default("data.items"),
  nextCursorPath: z.string().optional(),
  fields: z.object({
    externalId: z.string(),
    title: z.string(),
    summary: z.string().optional(),
    body: z.string().optional(),
    author: z.string().optional(),
    canonicalUrl: z.string().optional(),
    publishedAt: z.string().optional(),
    updatedAt: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    tags: z.string().optional(),
  }),
});

export const genericConnectorConfigSchema = z.object({
  baseUrl: z.string().url(),
  path: z.string().default(""),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  query: z.record(z.string(), z.string()).default({}),
  body: z.record(z.string(), z.unknown()).optional(),
  mapping: fieldMappingSchema,
});

export type GenericConnectorConfig = z.infer<typeof genericConnectorConfigSchema>;

function readPath(input: unknown, path?: string): unknown {
  if (!path) return undefined;
  return path.split(".").filter(Boolean).reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in value) return (value as Record<string, unknown>)[key];
    return undefined;
  }, input);
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export class GenericJsonConnector implements SourceConnector<GenericConnectorConfig, Record<string, unknown>> {
  readonly type: string = "generic_api";

  async validateConfig(config: unknown) {
    const result = genericConnectorConfigSchema.safeParse(config);
    return result.success ? { valid: true, errors: [] } : { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }

  async testConnection(config: GenericConnectorConfig) {
    try {
      const result = await this.fetchPage({ config });
      return { ok: true, message: `连接成功，预览 ${result.items.length} 条原始记录`, sample: result.items[0] };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "连接失败" };
    }
  }

  async fetchPage({ config, cursor, since }: { config: GenericConnectorConfig; cursor?: string | null; since?: string | null }) {
    const safe = genericConnectorConfigSchema.parse(config);
    const url = new URL(safe.path, safe.baseUrl.endsWith("/") ? safe.baseUrl : `${safe.baseUrl}/`);
    for (const [key, value] of Object.entries(safe.query)) url.searchParams.set(key, value);
    if (cursor) url.searchParams.set("cursor", cursor);
    if (since) url.searchParams.set("since", since);
    const response = await fetch(url, {
      method: safe.method,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...safe.headers },
      body: safe.method === "POST" ? JSON.stringify(safe.body ?? {}) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`来源返回 ${response.status}`);
    const payload = await response.json();
    const rawItems = readPath(payload, safe.mapping.itemsPath);
    if (!Array.isArray(rawItems)) throw new Error(`字段映射 ${safe.mapping.itemsPath} 不是数组`);
    const items = rawItems.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    const nextCursor = text(readPath(payload, safe.mapping.nextCursorPath));
    return { items, nextCursor, hasMore: Boolean(nextCursor) };
  }

  async normalize(): Promise<NormalizedContent> {
    throw new Error("normalize 需要通过 normalizeWithMapping(raw, config.mapping) 调用");
  }

  normalizeWithMapping(raw: Record<string, unknown>, mapping: z.infer<typeof fieldMappingSchema>): NormalizedContent {
    const f = mapping.fields;
    const tagsRaw = readPath(raw, f.tags);
    return normalizedContentSchema.parse({
      externalId: text(readPath(raw, f.externalId)) ?? "",
      contentType: "article",
      title: text(readPath(raw, f.title)) ?? "",
      summary: text(readPath(raw, f.summary)),
      body: text(readPath(raw, f.body)),
      author: text(readPath(raw, f.author)),
      canonicalUrl: text(readPath(raw, f.canonicalUrl)),
      publishedAt: text(readPath(raw, f.publishedAt)),
      updatedAt: text(readPath(raw, f.updatedAt)),
      thumbnailUrl: text(readPath(raw, f.thumbnailUrl)),
      tags: Array.isArray(tagsRaw) ? tagsRaw.map(String) : typeof tagsRaw === "string" ? tagsRaw.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) : [],
      metrics: {},
      sourceMetadata: {},
    });
  }
}
