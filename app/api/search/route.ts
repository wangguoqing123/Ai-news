import { demoContent, demoTopics, knowledgeCards } from "../../../lib/demo-data";
import { requireRequestContext } from "../../../lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireRequestContext(request); const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
    if (!q) return Response.json({ items:[] });
    const items = [
      ...demoContent.filter((item) => `${item.title}${item.summary}`.toLowerCase().includes(q)).map((item) => ({ type:"content",id:item.id,title:item.title,excerpt:item.summary })),
      ...demoTopics.filter((item) => `${item.topic}${item.angle}`.toLowerCase().includes(q)).map((item) => ({ type:"topic",id:item.id,title:item.topic,excerpt:item.angle })),
      ...knowledgeCards.filter((item) => `${item.title}${item.body}`.toLowerCase().includes(q)).map((item) => ({ type:"knowledge",id:item.id,title:item.title,excerpt:item.body })),
    ];
    return Response.json({ items,ranking:"demo_keyword; production uses PostgreSQL FTS + pgvector" });
  } catch (error) { return error instanceof Response ? error : Response.json({ error:"搜索失败" },{ status:500 }); }
}
