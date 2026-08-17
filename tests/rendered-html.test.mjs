import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("server renders Signal Desk without starter markers", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/today", { headers: { accept: "text/html" } }),env,ctx);
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-type") ?? "",/^text\/html\b/i);
  const html = await response.text();
  assert.match(html,/<title>Signal Desk｜信号台<\/title>/i);
  assert.match(html,/Signal Desk/);
  assert.match(html,/正在打开真实工作区|今天，先看真正重要的变化/);
  assert.doesNotMatch(html,/codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("health endpoint reports the running mode", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/health"),env,ctx);
  assert.equal(response.status,200);
  const data = await response.json();
  assert.equal(data.service,"signal-desk-web");
  assert.ok(["demo","supabase","unconfigured"].includes(data.mode));
});
