import { demoContent, demoTopics } from "../../../lib/demo-data";
import { requireRequestContext } from "../../../lib/server/auth";

export async function GET(request: Request) {
  try {
    const context = await requireRequestContext(request);
    return Response.json({ mode:context.mode,date:new Intl.DateTimeFormat("en-CA",{ timeZone:"Asia/Shanghai" }).format(new Date()),summary:{ added:47,deduplicated:21,learning:4,topics:3 },actions:[demoContent[1],demoContent[0],demoTopics[0]] });
  } catch (error) { return error instanceof Response ? error : Response.json({ error:"无法生成今日简报" },{ status:500 }); }
}
