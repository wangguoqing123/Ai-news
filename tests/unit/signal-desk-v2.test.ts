import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { creatorContentAnalysisSchema } from "../../lib/ai/schemas";
import { extractEntities } from "../../lib/clustering/cross-source";
import { eventSimilarity,groupEventCandidates } from "../../lib/clustering/events";
import { GetNotesConnector } from "../../lib/connectors/get-notes";
import { buildDailyBriefEntries } from "../../lib/daily-brief/generate";
import { defaultGetNotesMapping,normalizeWebhookItems } from "../../lib/services/get-notes-api-sync";
import { videosAfterCursor } from "../../lib/services/youtube-sync";
import { parseYouTubeChapters,parseYouTubeDuration,type YouTubePlaylistVideo } from "../../lib/youtube/api";

const root=process.cwd();
const read=(relative:string)=>fs.readFileSync(path.join(root,relative),"utf8");
const sourceFiles=(directory:string):string[]=>fs.readdirSync(path.join(root,directory),{withFileTypes:true}).flatMap((entry)=>entry.isDirectory()?sourceFiles(path.join(directory,entry.name)):[path.join(directory,entry.name)]).filter((file)=>/\.(tsx?|jsx?)$/.test(file));

test("event clustering groups the same launch and separates unrelated changes",()=>{
  assert.ok(eventSimilarity("OpenAI 发布 Codex 5.6", "OpenAI Codex 5.6 正式发布")>=0.55);
  const groups=groupEventCandidates([
    {id:"1",title:"OpenAI 发布 Codex 5.6",summary:null,publishedAt:null,signalScore:null,tags:[]},
    {id:"2",title:"OpenAI Codex 5.6 正式发布",summary:null,publishedAt:null,signalScore:null,tags:[]},
    {id:"3",title:"Seedance 更新视频模型",summary:null,publishedAt:null,signalScore:null,tags:[]},
  ]);
  assert.deepEqual(groups.map((group)=>group.map((item)=>item.id)),[["1","2"],["3"]]);
});

test("cross-source entities only expose recognized comparable topics",()=>{
  assert.deepEqual(extractEntities("Qwen、Claude 和 Codex 的多智能体工作流"),["Qwen / 千问","Codex","Claude","多智能体"]);
  assert.deepEqual(extractEntities("一条没有已知实体的普通内容"),[]);
});

test("creator analysis schema enforces recommendation and evidence structure",()=>{
  const parsed=creatorContentAnalysisSchema.parse({summary:"摘要",contentType:"教程",targetAudience:"创作者",problemSolved:"减少重复工作",corePoints:["先验证"],learningRecommendation:"deep_learn",learningReason:"有完整实测",learningTakeaways:["保留证据"],recommendedSegments:[{startMs:1_000,endMs:4_000,title:"实测",reason:"展示结果"}],topicOpportunity:{available:true,angle:"自己复现",audience:"新手",difference:"补充失败过程",validationTask:"完成一次复现"},evidenceRefs:["content:1"],confidence:.8});
  assert.equal(parsed.learningRecommendation,"deep_learn");
  assert.throws(()=>creatorContentAnalysisSchema.parse({...parsed,learningRecommendation:"must_watch"}));
});

test("YouTube playlist cursor, duration and chapters are incremental",()=>{
  const base:Omit<YouTubePlaylistVideo,"videoId"|"publishedAt">={playlistItemId:"p",title:"Title",description:"",channelId:"c",channelTitle:"Creator",thumbnailUrl:null};
  const items:YouTubePlaylistVideo[]=[{...base,videoId:"old",publishedAt:"2026-08-16T00:00:00.000Z"},{...base,videoId:"new",publishedAt:"2026-08-17T00:00:01.000Z"}];
  assert.deepEqual(videosAfterCursor(items,"2026-08-17T00:00:00.000Z").map((item)=>item.videoId),["new"]);
  assert.equal(parseYouTubeDuration("PT1H2M3S"),3723);
  assert.deepEqual(parseYouTubeChapters("00:00 开始\n01:30 实测"),[{startSeconds:0,title:"开始"},{startSeconds:90,title:"实测"}]);
});

test("Get Notes mapping preserves concrete content and marks missing interactions",()=>{
  const connector=new GetNotesConnector();
  const normalized=connector.normalizeWithMapping({id:"n1",title:"真实标题",body:"正文",creator:{id:"c1",name:"作者"},platform:"douyin",url:"https://example.com/n1",publishedAt:"2026-08-17T00:00:00.000Z",cover:"https://example.com/cover.jpg"},defaultGetNotesMapping);
  assert.equal(normalized.externalId,"n1");
  assert.equal(normalized.body,"正文");
  assert.equal(normalized.author,"作者");
  assert.equal(normalized.sourceMetadata.interactionAvailable,false);
  assert.equal(normalizeWebhookItems({items:[{id:"n2",title:"Webhook",publishedAt:"2026-08-17T00:00:00.000Z"}]}).length,1);
});

test("daily brief links every editorial entry back to evidence",()=>{
  const entries=buildDailyBriefEntries({events:[{id:"e1",title:"事件",summary:"发生了什么"}],trend:{id:"tr1",title:"趋势",summary:"两个来源共同出现"},creator:{id:"c1",title:"视频",summary:"实测"},topic:{id:"t1",topic:"选题",differentiated_angle:"补充失败过程"}});
  assert.deepEqual(entries.map((item)=>item.kind),["event","trend","creator","topic"]);
  assert.ok(entries.every((item)=>item.href.includes(item.id.split("-")[1])));
});

test("production pages have no demo imports or fixed V1 statistics",()=>{
  const production=["components/daily-brief/today-dashboard.tsx","components/events/ai-news-page.tsx","components/creators/creator-feed.tsx","components/learning/learning-hub.tsx","app/api/today/route.ts","app/api/search/route.ts","app/api/topics/route.ts"].map(read).join("\n");
  assert.doesNotMatch(production,/demo-data|demoContent|demoTopics|knowledgeCards|transcriptSegments/);
  assert.doesNotMatch(production,/47 条新增|21 条去重|今日三项|score:\s*92/);
  assert.match(read("lib/server/auth.ts"),/SIGNAL_DESK_DEMO_MODE === "true"/);
  assert.match(read("components/layout/workspace-shell.tsx"),/演示模式 · 不含真实数据/);
});

test("internal links avoid vinext production RSC prefetch runtime",()=>{
  const applicationSource=[...sourceFiles("app"),...sourceFiles("components")].map(read).join("\n");
  assert.doesNotMatch(applicationSource,/from\s*["']next\/link["']/);
  assert.match(read("components/ui/app-link.tsx"),/return <a \{\.\.\.props\}>\{children\}<\/a>/);
});

test("learning details and topics are dynamic and persist source relations",()=>{
  assert.ok(fs.existsSync(path.join(root,"app/(app)/learning/[contentId]/page.tsx")));
  assert.match(read("app/(app)/learning/[contentId]/page.tsx"),/params/);
  assert.match(read("app/api/learning/[id]/progress/route.ts"),/learning_progress/);
  assert.match(read("app/api/learning/[id]/artifacts/route.ts"),/knowledge_card_sources/);
  const topics=read("app/api/topics/route.ts");
  assert.match(topics,/sources\.length/);
  assert.match(topics,/topic_sources/);
  assert.match(topics,/source_id:source\.id/);
});
