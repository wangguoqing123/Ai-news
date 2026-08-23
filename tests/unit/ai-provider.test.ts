import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { OpenAICompatibleProvider } from "../../lib/ai/provider";

test("AI provider sends a strict structured-output schema and records usage",async()=>{
  const originalFetch=globalThis.fetch;
  let requestBody:Record<string,unknown>|null=null;
  globalThis.fetch=async(_input,init)=>{
    requestBody=JSON.parse(String(init?.body))as Record<string,unknown>;
    return new Response(JSON.stringify({choices:[{message:{content:'{"answer":"ok"}'}}],usage:{prompt_tokens:12,completion_tokens:4}}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try{
    const provider=new OpenAICompatibleProvider({baseUrl:"https://api.example.com/v1",apiKey:"secret",model:"model",embeddingModel:"embed"});
    const result=await provider.generateStructuredDetailed({system:"system",prompt:"prompt",schemaName:"smoke",schema:z.object({answer:z.string()})});
    const format=(requestBody as unknown as{response_format?:{type?:string;json_schema?:{strict?:boolean;name?:string;schema?:Record<string,unknown>}}}).response_format;
    assert.equal(format?.type,"json_schema");assert.equal(format?.json_schema?.strict,true);assert.equal(format?.json_schema?.name,"smoke");assert.deepEqual(format?.json_schema?.schema?.required,["answer"]);
    assert.deepEqual(result.data,{answer:"ok"});assert.equal(result.inputTokens,12);assert.equal(result.outputTokens,4);
  }finally{globalThis.fetch=originalFetch;}
});
