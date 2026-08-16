import { GenericJsonConnector, genericConnectorConfigSchema } from "../../../../lib/connectors/generic-json";
import { requireRequestContext } from "../../../../lib/server/auth";
import { assertSafeConnectorUrl } from "../../../../lib/security/url";

export async function POST(request: Request) {
  try {
    await requireRequestContext(request);
    const input = genericConnectorConfigSchema.safeParse(await request.json());
    if (!input.success) return Response.json({ ok:false,error:input.error.flatten() },{ status:400 });
    assertSafeConnectorUrl(input.data.baseUrl);
    const connector = new GenericJsonConnector();
    const result = await connector.testConnection(input.data);
    return Response.json(result,{ status:result.ok ? 200 : 502 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ ok:false,error:error instanceof Error ? error.message : "连接测试失败" },{ status:400 });
  }
}
