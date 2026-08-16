import { demoContent } from "../../../lib/demo-data";
import { requireRequestContext } from "../../../lib/server/auth";

export async function GET(request: Request) {
  try {
    const context = await requireRequestContext(request); const url = new URL(request.url); const source = url.searchParams.get("source");
    const items = source ? demoContent.filter((item) => item.sourceType === source) : demoContent;
    return Response.json({ mode:context.mode,items,nextCursor:null });
  } catch (error) { return error instanceof Response ? error : Response.json({ error:"无法读取收件箱" },{ status:500 }); }
}
