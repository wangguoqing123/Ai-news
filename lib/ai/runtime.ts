import { OpenAICompatibleProvider,type AIProvider } from "./provider";

let workerProviderFactory:(()=>AIProvider)|null=null;

export function setWorkerAIProviderFactory(factory:(()=>AIProvider)|null){workerProviderFactory=factory;}

export function getAIProvider():AIProvider|null{
  if(workerProviderFactory)return workerProviderFactory();
  if(process.env.AI_PROVIDER==="codex_cli")return null;
  const apiKey=process.env.AI_API_KEY;const model=process.env.AI_MODEL;const embeddingModel=process.env.AI_EMBEDDING_MODEL;
  if(!apiKey || !model || !embeddingModel)return null;
  return new OpenAICompatibleProvider({baseUrl:process.env.AI_BASE_URL ?? "https://api.openai.com/v1",apiKey,model,embeddingModel});
}
