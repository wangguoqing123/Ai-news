import { z } from "zod";
import { requeueAnalysis } from "../../../../lib/services/analysis-queue";
import { requireRequestContext } from "../../../../lib/server/auth";
import { getSupabaseAdmin } from "../../../../lib/server/supabase-admin";

const profileSchema=z.object({
  identityText:z.string().trim().min(1).max(2000),
  contentDirection:z.string().trim().min(1).max(4000),
  targetAudience:z.string().trim().min(1).max(4000),
  formats:z.array(z.string().trim().min(1).max(80)).max(20),
  focusTopics:z.array(z.string().trim().min(1).max(80)).max(50),
  excludedTopics:z.array(z.string().trim().min(1).max(120)).max(50),
  products:z.string().max(4000),
  valueCriteria:z.string().trim().min(1).max(6000),
  forbiddenContent:z.array(z.string().trim().min(1).max(200)).max(50),
  historicalTopics:z.array(z.string().trim().min(1).max(300)).max(500),
  applyMode:z.enum(["new_only","pending","last_7_days"]),
});

function present(row:Record<string,unknown>){
  const criteria=row.value_criteria&&typeof row.value_criteria==="object"?row.value_criteria as Record<string,unknown>:{};
  return{
    id:row.id,version:row.version,isActive:row.is_active,
    identityText:row.identity_text??"",contentDirection:row.content_direction??"",
    targetAudience:row.target_audience??"",formats:row.formats??[],
    focusTopics:row.focus_topics??[],excludedTopics:row.excluded_topics??[],
    products:row.products??"",valueCriteria:typeof criteria.text==="string"?criteria.text:"",
    forbiddenContent:row.forbidden_content??[],historicalTopics:row.historical_topics??[],
    createdAt:row.created_at,updatedAt:row.updated_at,
  };
}

export async function GET(request:Request){
  try{
    const context=await requireRequestContext(request);
    if(context.mode==="demo")return Response.json({mode:"demo",current:null,versions:[]});
    const{data,error}=await getSupabaseAdmin().from("content_profiles")
      .select("id,version,is_active,identity_text,content_direction,target_audience,formats,focus_topics,excluded_topics,products,value_criteria,forbidden_content,historical_topics,created_at,updated_at")
      .eq("workspace_id",context.workspaceId).order("version",{ascending:false});
    if(error)throw new Error(error.message);
    const versions=(data??[]).map(row=>present(row as Record<string,unknown>));
    return Response.json({mode:"live",current:versions.find(item=>item.isActive)??null,versions});
  }catch(error){
    if(error instanceof Response)return error;
    return Response.json({error:error instanceof Error?error.message:"读取内容画像失败"},{status:500});
  }
}

export async function POST(request:Request){
  try{
    const context=await requireRequestContext(request);
    if(context.mode==="demo")return Response.json({error:"演示模式不能保存内容画像"},{status:409});
    const parsed=profileSchema.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return Response.json({error:"内容画像字段无效",issues:parsed.error.issues},{status:400});
    const admin=getSupabaseAdmin();
    const value=parsed.data;
    const{data,error}=await admin.rpc("create_content_profile_version",{
      target_workspace_id:context.workspaceId,
      profile_data:{
        identity_text:value.identityText,content_direction:value.contentDirection,
        target_audience:value.targetAudience,formats:value.formats,
        focus_topics:value.focusTopics,excluded_topics:value.excludedTopics,
        products:value.products,value_criteria:{text:value.valueCriteria},
        forbidden_content:value.forbiddenContent,historical_topics:value.historicalTopics,
      },
    });
    if(error||!data)throw new Error(error?.message??"保存内容画像失败");
    const created=(Array.isArray(data)?data[0]:data)as Record<string,unknown>;
    let requeue={requested:0,jobs:[]as Array<Record<string,unknown>>};
    if(value.applyMode==="pending")requeue=await requeueAnalysis(admin,{workspaceId:context.workspaceId,allPending:true});
    if(value.applyMode==="last_7_days")requeue=await requeueAnalysis(admin,{workspaceId:context.workspaceId,days:7});
    return Response.json({ok:true,current:present(created),requeue},{status:201});
  }catch(error){
    if(error instanceof Response)return error;
    return Response.json({error:error instanceof Error?error.message:"保存内容画像失败"},{status:500});
  }
}
