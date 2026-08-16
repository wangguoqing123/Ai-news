export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead_letter";

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
  "sync_aihot",
  "sync_get_notes",
  "normalize_content",
  "deduplicate_content",
  "fetch_transcript",
  "embed_content",
  "cluster_event",
  "analyze_preview",
  "analyze_learning",
  "analyze_competitor",
  "generate_daily_brief",
  "generate_topic",
  "generate_quiz",
  "grade_quiz",
  "generate_weekly_review",
  "reprocess_content",
  "cleanup_expired_jobs",
] as const;

export type JobType = typeof JOB_TYPES[number];
