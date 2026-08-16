import { AIHotConnector, aihotConfigSchema } from "../../../../../lib/connectors/aihot";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = aihotConfigSchema.safeParse({
    baseUrl: "https://aihot.virxact.com/api/v1",
    mode: url.searchParams.get("mode") ?? "selected",
    window: url.searchParams.get("window") ?? "24h",
    limit: Number(url.searchParams.get("limit") ?? 8),
  });
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });

  try {
    const connector = new AIHotConnector();
    const page = await connector.fetchPage({ config: parsed.data, cursor: url.searchParams.get("cursor") });
    const items = await Promise.all(page.items.map((item) => connector.normalize(item)));
    return Response.json({ ok: true, provenance: "verified_live", items, nextCursor: page.nextCursor, hasMore: page.hasMore }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "同步失败" }, { status: 502 });
  }
}
