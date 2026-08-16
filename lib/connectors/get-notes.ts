import { z } from "zod";
import { GenericJsonConnector, genericConnectorConfigSchema } from "./generic-json";

export const getNotesConfigSchema = genericConnectorConfigSchema.extend({
  knowledgeBaseId: z.string().min(1),
  tokenHeader: z.string().default("Authorization"),
  tokenPrefix: z.string().default("Bearer"),
  updatedAtQuery: z.string().default("updated_at"),
});

export type GetNotesConfig = z.infer<typeof getNotesConfigSchema>;

export class GetNotesConnector extends GenericJsonConnector {
  override readonly type = "get_notes";

  override async validateConfig(config: unknown) {
    const result = getNotesConfigSchema.safeParse(config);
    return result.success ? { valid: true, errors: [] } : { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
}
