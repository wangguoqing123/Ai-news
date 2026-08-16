import test from "node:test";
import assert from "node:assert/strict";
import { nextJobStatus, nextRetryAt } from "../../lib/jobs";

test("job retry uses capped exponential backoff", () => {
  const now = new Date("2026-08-17T00:00:00.000Z");
  assert.equal(nextRetryAt(1,now).toISOString(), "2026-08-17T00:00:15.000Z");
  assert.equal(nextRetryAt(4,now).toISOString(), "2026-08-17T00:02:00.000Z");
  assert.equal(nextRetryAt(10,now).toISOString(), "2026-08-17T01:00:00.000Z");
});

test("job moves to dead letter at max attempts", () => {
  assert.equal(nextJobStatus(4,5), "queued");
  assert.equal(nextJobStatus(5,5), "dead_letter");
});
