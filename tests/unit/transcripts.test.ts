import test from "node:test";
import assert from "node:assert/strict";
import { parseSrt } from "../../lib/transcripts/manual";

test("manual transcript provider parses SRT timestamps", () => {
  const result = parseSrt("1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond line");
  assert.equal(result.segments.length,2);
  assert.deepEqual(result.segments[0], { startMs: 1000, endMs: 3500, text: "Hello world" });
});
