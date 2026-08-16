import test from "node:test";
import assert from "node:assert/strict";
import { contentFingerprints, normalizeCanonicalUrl, normalizeTitle } from "../../lib/dedupe";

test("title normalization removes punctuation and width differences", () => {
  assert.equal(normalizeTitle("ＡＩ 日报：真的越多越好吗？"), normalizeTitle("AI日报真的越多越好吗"));
});

test("canonical URL removes tracking parameters", () => {
  assert.equal(normalizeCanonicalUrl("https://www.example.com/post/?utm_source=x&id=3#top"), "https://example.com/post?id=3");
});

test("source id remains the first deterministic identity", () => {
  const result = contentFingerprints({ sourceType: "aihot", externalId: "42", title: "Example" });
  assert.equal(result.external, "aihot:42");
  assert.equal(result.title.length, 64);
});
