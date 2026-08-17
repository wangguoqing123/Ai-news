import type { SupabaseClient } from "@supabase/supabase-js";
import type { YouTubeSubscription } from "./api";

export async function persistYouTubeSubscriptions(input: {
  admin: SupabaseClient;
  workspaceId: string;
  connectionId: string;
  subscriptions: YouTubeSubscription[];
}) {
  const { data:source,error:sourceError } = await input.admin.from("sources").upsert({
    workspace_id:input.workspaceId,
    connection_id:input.connectionId,
    external_id:"subscriptions",
    name:"YouTube 订阅",
    type:"youtube",
    status:"active",
    priority:70,
    trust_level:80,
    processing_mode:"learning_priority",
    sync_frequency_minutes:360,
    last_success_at:new Date().toISOString(),
    last_error:null,
    metadata:{ importMode:"official_api",subscriptionCount:input.subscriptions.length },
  },{ onConflict:"workspace_id,type,external_id" }).select("id").single();
  if (sourceError || !source) throw new Error("保存 YouTube 来源失败");

  if (input.subscriptions.length) {
    const { error:subscriptionError } = await input.admin.from("source_subscriptions").upsert(input.subscriptions.map((item) => ({
      workspace_id:input.workspaceId,
      source_id:source.id,
      external_id:item.channelId,
      name:item.name,
      enabled:true,
      priority:50,
      muted:false,
      metadata:{ uploadsPlaylistId:item.uploadsPlaylistId,iconUrl:item.iconUrl },
    })),{ onConflict:"workspace_id,source_id,external_id" });
    if (subscriptionError) throw new Error("保存 YouTube 订阅频道失败");
  }
  return { sourceId:source.id,count:input.subscriptions.length };
}
