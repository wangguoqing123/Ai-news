import { OpenAICompatibleProvider,type AIProvider } from "./provider";

export function getAIProvider():AIProvider|null{
  const apiKey=process.env.AI_API_KEY;const model=process.env.AI_MODEL;const embeddingModel=process.env.AI_EMBEDDING_MODEL;
  if(!apiKey || !model || !embeddingModel)return null;
  return new OpenAICompatibleProvider({baseUrl:process.env.AI_BASE_URL ?? "https://api.openai.com/v1",apiKey,model,embeddingModel});
}
