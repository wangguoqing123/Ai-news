import { z } from "zod";

export const normalizedContentSchema = z.object({
  externalId: z.string().min(1),
  contentType: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().nullable().default(null),
  body: z.string().nullable().default(null),
  author: z.string().nullable().default(null),
  canonicalUrl: z.string().url().nullable().default(null),
  publishedAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
  language: z.string().nullable().default(null),
  durationSeconds: z.number().int().nonnegative().nullable().default(null),
  thumbnailUrl: z.string().url().nullable().default(null),
  tags: z.array(z.string()).default([]),
  metrics: z.record(z.string(), z.number().nullable()).default({}),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
});

export type NormalizedContent = z.infer<typeof normalizedContentSchema>;

export type ValidationResult = { valid: boolean; errors: string[] };
export type TestResult = { ok: boolean; message: string; sample?: unknown };

export interface SourceConnector<TConfig, TRaw> {
  type: string;
  validateConfig(config: unknown): Promise<ValidationResult>;
  testConnection(config: TConfig): Promise<TestResult>;
  fetchPage(input: {
    config: TConfig;
    cursor?: string | null;
    since?: string | null;
  }): Promise<{ items: TRaw[]; nextCursor?: string | null; hasMore: boolean }>;
  normalize(raw: TRaw): Promise<NormalizedContent>;
}
