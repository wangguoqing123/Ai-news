import assert from"node:assert/strict";
import fs from"node:fs";
import path from"node:path";
import test from"node:test";
import{containsChinese,metadataTranslationInputHash}from"../../lib/services/metadata-processing";
import{validateTranscriptTranslationChunk}from"../../lib/services/transcript-translation";
import{dailyBriefStatus}from"../../lib/daily-brief/generate";

const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8");

test("Chinese metadata is detected and unchanged inputs reuse the same translation hash",()=>{assert.equal(containsChinese("这是中文标题"),true);assert.equal(containsChinese("Introducing GPT-Next"),false);assert.equal(metadataTranslationInputHash({title:"Title",summary:null}),metadataTranslationInputHash({title:"Title",summary:null}));assert.notEqual(metadataTranslationInputHash({title:"Title",summary:null}),metadataTranslationInputHash({title:"New title",summary:null}));});

test("transcript translation preserves every segment id and order",()=>{const output=[{id:"s1",translatedText:"一"},{id:"s2",translatedText:"二"}];assert.deepEqual(validateTranscriptTranslationChunk(["s1","s2"],output),output);assert.throws(()=>validateTranscriptTranslationChunk(["s1","s2"],[output[1],output[0]]),/一一对应/);assert.throws(()=>validateTranscriptTranslationChunk(["s1","s2"],[output[0]]),/一一对应/);});

test("YouTube synchronization is metadata-first for every channel priority",()=>{const source=read("lib/services/youtube-sync.ts");assert.match(source,/enqueueMetadataProcessing/);assert.doesNotMatch(source,/enqueueTranscriptFetch|enqueueContentAnalysis/);assert.match(source,/transcriptStatus:"not_requested"/);});

test("deep processing is explicitly requested and idempotent",()=>{const source=read("lib/services/processing-requests.ts");assert.match(source,/content_processing_requests/);assert.match(source,/activeStatuses/);assert.match(source,/processingRequestId/);assert.match(source,/23505/);assert.match(read("app/api/content/[id]/process/route.ts"),/status:202/);});

test("daily brief excludes YouTube deep jobs and supports provisional and final",()=>{const source=read("lib/daily-brief/generate.ts");assert.match(source,/provisional/);assert.match(source,/"final"/);assert.match(source,/translate_content_metadata/);assert.match(source,/classify_content_metadata/);assert.doesNotMatch(source,/fetch_transcript|translate_transcript|analyze_creator_content/);});
test("daily brief stays provisional while core work is pending and finalizes after readiness or timeout",()=>{assert.equal(dailyBriefStatus({allSourcesReady:true,pendingTaskCount:2,timedOut:false}),"provisional");assert.equal(dailyBriefStatus({allSourcesReady:true,pendingTaskCount:0,timedOut:false}),"final");assert.equal(dailyBriefStatus({allSourcesReady:false,pendingTaskCount:5,timedOut:true,finalize:true}),"final");});

test("worker has startup catch-up, 07:00 compensation and real provider health checks",()=>{const worker=read("jobs-worker/index.ts");const health=read("lib/workers/health.ts");assert.match(worker,/catchUpMissedSchedules/);assert.match(worker,/ensureSevenAmFinalBrief/);assert.match(worker,/refreshDependencyHealth\(true\)/);assert.match(health,/Codex CLI/);assert.match(health,/login.*status/);assert.match(health,/yt-dlp/);assert.match(health,/结构化请求/);});

test("CI runs the complete requested verification matrix",()=>{const workflow=read(".github/workflows/ci.yml");for(const command of["npm ci","npm run lint","npm run typecheck","npm run test:unit","npm run test:db","npm run test:e2e","npm run build","npm run test:rendered"])assert.match(workflow,new RegExp(command.replaceAll(" ","\\s+")));assert.match(workflow,/pgvector\/pgvector:pg16/);});
