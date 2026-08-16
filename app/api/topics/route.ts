import { demoTopics } from "../../../lib/demo-data";
import { requireRequestContext } from "../../../lib/server/auth";

export async function GET(request: Request) {
  try { const context = await requireRequestContext(request); return Response.json({ mode:context.mode,items:demoTopics }); }
  catch (error) { return error instanceof Response ? error : Response.json({ error:"无法读取选题" },{ status:500 }); }
}
