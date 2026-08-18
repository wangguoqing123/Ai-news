import type{SupabaseClient}from"@supabase/supabase-js";
import{getAIProvider}from"../ai/runtime";
import{eventMergeJudgementSchema}from"../ai/schemas";
import{eventSimilarity}from"./events";

function cosine(a:number[],b:number[]){let dot=0,aa=0,bb=0;for(let index=0;index<Math.min(a.length,b.length);index++){dot+=a[index]*b[index];aa+=a[index]*a[index];bb+=b[index]*b[index];}return aa&&bb?dot/(Math.sqrt(aa)*Math.sqrt(bb)):0;}

export async function semanticEventDedupe(admin:SupabaseClient,workspaceId:string,input:{since:string;until:string}){
  const provider=getAIProvider();
  if(!provider)return{status:"analysis_pending"as const,reason:"AI Provider 未配置",embedded:0,judged:0,merged:0};
  const{data,error}=await admin.from("content_items").select("id,title,summary,body,source:sources!inner(type)").eq("workspace_id",workspaceId).eq("sources.type","aihot").gte("published_at",input.since).lt("published_at",input.until).is("duplicate_of_id",null);
  if(error)throw new Error(error.message);
  const items=data??[];
  if(items.length<2)return{status:"ready"as const,embedded:provider.supportsEmbeddings?items.length:0,judged:0,merged:0};
  let vectors:number[][]|null=null;
  if(provider.supportsEmbeddings){
    vectors=await provider.embed(items.map(item=>`${item.title}\n${item.summary??""}`));
    for(let index=0;index<items.length;index++){
      const stored=await admin.from("content_embeddings").upsert({workspace_id:workspaceId,content_id:items[index].id,chunk_index:0,chunk_text:`${items[index].title}\n${items[index].summary??""}`,model:process.env.AI_EMBEDDING_MODEL,embedding:vectors[index]},{onConflict:"content_id,chunk_index,model"});
      if(stored.error)throw new Error(stored.error.message);
    }
  }
  let judged=0,merged=0;
  for(let left=0;left<items.length;left++)for(let right=left+1;right<items.length;right++){
    const similarity=vectors?cosine(vectors[left],vectors[right]):eventSimilarity(items[left].title,items[right].title);
    if(similarity<(vectors?.length?0.82:0.35))continue;
    const judgement=await provider.generateStructured({schema:eventMergeJudgementSchema,schemaName:"event_merge_judgement",system:"判断两条报道是否描述同一个现实事件。相同主题但不同发布、不同版本或不同事件必须返回 false。",prompt:JSON.stringify({left:items[left],right:items[right],recallSimilarity:similarity,recallMethod:vectors?"embedding":"title_rule"}),temperature:0});
    judged+=1;
    if(!judgement.sameEvent||judgement.confidence<.8)continue;
    const{data:relations}=await admin.from("event_cluster_items").select("cluster_id,content_id").in("content_id",[items[left].id,items[right].id]);
    const clusterIds=[...new Set((relations??[]).map(item=>item.cluster_id))];
    if(clusterIds.length!==2)continue;
    const target=clusterIds[0],source=clusterIds[1];
    const{data:sourceItems}=await admin.from("event_cluster_items").select("content_id").eq("cluster_id",source);
    if(sourceItems?.length){
      await admin.from("event_cluster_items").upsert(sourceItems.map(item=>({workspace_id:workspaceId,cluster_id:target,content_id:item.content_id,relation:"report"})),{onConflict:"cluster_id,content_id"});
      await admin.from("event_cluster_items").delete().eq("cluster_id",source);
      await admin.from("event_clusters").update({status:"merged"}).eq("id",source);
      merged+=1;
    }
  }
  return{status:"ready"as const,embedded:vectors?.length??0,judged,merged};
}
