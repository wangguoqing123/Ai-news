export type JobStatus = "queued" | "running" | "blocked" | "succeeded" | "failed" | "dead_letter" | "cancelled";

export type DependencyType = "ai_provider" | "ai_budget" | "transcript_provider" | "content_profile";

export type BlockedJobResult = {
  status:"blocked";
  dependencyType:DependencyType;
  reason:string;
  nextRetryAt?:string;
};

export class RetryableJobError extends Error{
  constructor(message:string,readonly retryAfterMs:number,readonly scope:"job"|"job_type"|"transcript_pipeline"="job"){super(message);this.name="RetryableJobError";}
}

export function blockedJob(
  dependencyType:DependencyType,
  reason:string,
  now=new Date(),
):BlockedJobResult {
  return {
    status:"blocked",
    dependencyType,
    reason,
    nextRetryAt:new Date(now.getTime()+15*60_000).toISOString(),
  };
}

export function isBlockedJobResult(value:unknown):value is BlockedJobResult {
  return Boolean(value && typeof value === "object" && (value as {status?:unknown}).status === "blocked");
}

export function dependencyConfigured(type:DependencyType,env:Record<string,string|undefined>=process.env) {
  if (type === "ai_provider") return env.AI_PROVIDER === "codex_cli" ? Boolean(env.CODEX_CLI_PATH) : Boolean(env.AI_API_KEY && env.AI_MODEL && env.AI_EMBEDDING_MODEL);
  if (type === "ai_budget") return false;
  if (type === "transcript_provider") return Boolean(env.TRANSCRIPT_PROVIDER && env.TRANSCRIPT_PROVIDER !== "manual_required");
  return true;
}

export function heartbeatIntervalMs(leaseMs:number) {
  return Math.max(30_000,Math.min(60_000,Math.floor(leaseMs/4)));
}

export function shouldRecoverLease(input:{
  now:number;
  leaseExpiresAt:number;
  heartbeatAt:number|null;
  workerLastSeenAt:number|null;
  safetyMs?:number;
}) {
  const safety=input.safetyMs ?? 120_000;
  return input.leaseExpiresAt < input.now
    && (input.heartbeatAt === null || input.heartbeatAt < input.now-safety)
    && (input.workerLastSeenAt === null || input.workerLastSeenAt < input.now-safety);
}

export function nextRetryAt(attempt: number, now = new Date()): Date {
  const cappedAttempt = Math.max(1, Math.min(attempt, 10));
  const seconds = Math.min(3600, 15 * 2 ** (cappedAttempt - 1));
  return new Date(now.getTime() + seconds * 1000);
}

export function nextJobStatus(attempt: number, maxAttempts: number): JobStatus {
  return attempt >= maxAttempts ? "dead_letter" : "queued";
}

export const JOB_TYPES = [
  "sync_youtube_subscriptions",
  "sync_youtube_channel",
  "sync_youtube_channels",
  "sync_youtube_channel_videos",
  "fetch_youtube_video_details",
  "sync_aihot",
  "sync_get_notes",
  "normalize_get_notes_item",
  "cluster_competitor_topics",
  "normalize_content",
  "exact_dedupe",
  "semantic_dedupe",
  "deduplicate_content",
  "fetch_transcript",
  "embed_content",
  "cluster_event",
  "analyze_event",
  "analyze_preview",
  "analyze_learning",
  "analyze_creator_content",
  "analyze_competitor_content",
  "analyze_competitor",
  "analyze_cross_source",
  "generate_daily_brief",
  "generate_topic",
  "generate_quiz",
  "grade_quiz",
  "generate_weekly_review",
  "reprocess_content",
  "cleanup_expired_jobs",
] as const;

export type JobType = typeof JOB_TYPES[number];
