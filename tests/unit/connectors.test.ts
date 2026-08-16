import test from "node:test";
import assert from "node:assert/strict";
import { AIHotConnector } from "../../lib/connectors/aihot";
import { GenericJsonConnector } from "../../lib/connectors/generic-json";

test("AIHot normalize preserves evidence links and null metrics", async () => {
  const connector = new AIHotConnector();
  const result = await connector.normalize({ title: "Test", publicId: "x", links: { aihot: "https://aihot.virxact.com/item/x", original: "https://example.com/x" }, source: { name: "Official" }, publishedAt: "2026-08-17T00:00:00.000Z", score: null });
  assert.equal(result.externalId,"x");
  assert.equal(result.metrics.editorialScore,null);
  assert.equal(result.canonicalUrl,"https://example.com/x");
});

test("generic connector uses visual field mapping instead of hardcoded fields", () => {
  const connector = new GenericJsonConnector();
  const result = connector.normalizeWithMapping({ row: { uid: 7, heading: "Mapped", labels: ["one","two"] } }, { itemsPath: "items", fields: { externalId: "row.uid", title: "row.heading", tags: "row.labels" } });
  assert.equal(result.externalId,"7");
  assert.deepEqual(result.tags,["one","two"]);
});
