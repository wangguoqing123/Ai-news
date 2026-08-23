import test from "node:test";
import assert from "node:assert/strict";
import { blockedJob,dependencyConfigured,heartbeatIntervalMs,nextJobStatus,nextRetryAt,shouldRecoverLease } from "../../lib/jobs";
import { analysisJobKey } from "../../lib/analysis/config";

test("job retry uses capped exponential backoff", () => {
  const now = new Date("2026-08-17T00:00:00.000Z");
  assert.equal(nextRetryAt(1,now).toISOString(), "2026-08-17T00:00:15.000Z");
  assert.equal(nextRetryAt(4,now).toISOString(), "2026-08-17T00:02:00.000Z");
  assert.equal(nextRetryAt(10,now).toISOString(), "2026-08-17T01:00:00.000Z");
});

test("blocked jobs preserve dependency semantics and can be resumed after configuration",()=>{
  const blocked=blockedJob("ai_provider","AI Provider 未配置",new Date("2026-08-17T00:00:00Z"));
  assert.equal(blocked.status,"blocked");assert.equal(blocked.nextRetryAt,"2026-08-17T00:15:00.000Z");
  assert.equal(dependencyConfigured("ai_provider",{}),false);
  assert.equal(dependencyConfigured("ai_provider",{AI_API_KEY:"key",AI_MODEL:"model",AI_EMBEDDING_MODEL:"embed"}),true);
  assert.equal(dependencyConfigured("ai_budget",{}),false);
});

test("analysis idempotency includes content, prompt, profile and analysis versions",()=>{
  const base={entityType:"content"as const,entityId:"content-1",inputHash:"hash-1",promptVersion:"prompt-v1",profileVersion:2,analysisVersion:"analysis-v1"};
  assert.notEqual(analysisJobKey("analyze_creator_content",base),analysisJobKey("analyze_creator_content",{...base,promptVersion:"prompt-v2"}));
  assert.notEqual(analysisJobKey("analyze_creator_content",base),analysisJobKey("analyze_creator_content",{...base,profileVersion:3}));
  assert.notEqual(analysisJobKey("analyze_creator_content",base),analysisJobKey("analyze_creator_content",{...base,inputHash:"hash-2"}));
});

test("heartbeat renews well before lease and cleanup only recovers stale workers",()=>{
  assert.equal(heartbeatIntervalMs(300_000),60_000);
  assert.equal(shouldRecoverLease({now:1_000_000,leaseExpiresAt:900_000,heartbeatAt:950_000,workerLastSeenAt:950_000}),false);
  assert.equal(shouldRecoverLease({now:1_000_000,leaseExpiresAt:800_000,heartbeatAt:800_000,workerLastSeenAt:800_000}),true);
});

test("job moves to dead letter at max attempts", () => {
  assert.equal(nextJobStatus(4,5), "queued");
  assert.equal(nextJobStatus(5,5), "dead_letter");
});
