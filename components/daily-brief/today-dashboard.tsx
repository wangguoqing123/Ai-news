"use client";

import { ArrowRight,CalendarDays,Clock3,ExternalLink,RefreshCw,Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import type { TodayPayload } from "../../lib/domain/signal-desk";
import { apiFetch } from "../../lib/client/api";

const formatter = new Intl.DateTimeFormat("zh-CN",{ month:"long",day:"numeric",weekday:"long",timeZone:"Asia/Shanghai" });
const timeFormatter = new Intl.DateTimeFormat("zh-CN",{ hour:"2-digit",minute:"2-digit",timeZone:"Asia/Shanghai" });
function today() { return new Intl.DateTimeFormat("en-CA",{ timeZone:"Asia/Shanghai" }).format(new Date()); }
function duration(seconds:number|null) { if (!seconds) return null; const minutes=Math.floor(seconds/60); return `${Math.floor(minutes/60) ? `${Math.floor(minutes/60)} 小时 ` : ""}${minutes%60} 分钟`; }

export function TodayDashboard() {
  const [date,setDate] = useState(today);
  const [data,setData] = useState<TodayPayload|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [loading,setLoading] = useState(true);
  const [syncing,setSyncing]=useState(false);
  const load = useCallback(async () => { setLoading(true);setError(null);try { setData(await apiFetch<TodayPayload>(`/api/today?date=${date}`)); } catch (reason) { setError(reason instanceof Error ? reason.message : "读取失败"); } finally { setLoading(false); } },[date]);
  useEffect(() => { void load(); },[load]);
  const refresh=async()=>{setSyncing(true);try{await apiFetch("/api/sync/run",{method:"POST",body:JSON.stringify({sources:["aihot","youtube"]})});await load()}catch(reason){setError(reason instanceof Error?reason.message:"同步失败")}finally{setSyncing(false)}};
  return <div className="v2-page">
    <header className="v2-page-header">
      <div><div className="v2-date"><CalendarDays size={15} />{formatter.format(new Date(`${date}T12:00:00+08:00`))}<span>{data?.windowLabel ?? "过去 24 小时"}</span></div><h1>今天，先看真正重要的变化</h1><p>AI 世界发生了什么、关注的博主更新了什么，以及哪些内容值得投入时间。</p></div>
      <div className="v2-header-actions"><label className="v2-date-picker"><span className="sr-only">切换日期</span><input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} /></label><button onClick={() => void refresh()} disabled={loading||syncing}><RefreshCw size={16} className={syncing ? "spin" : ""} />{syncing?"同步中":"手动刷新"}</button></div>
    </header>
    {error && <div className="v2-error">{error}<button onClick={() => void load()}>重试</button></div>}
    <section className="v2-stat-strip" aria-label="今日数据">
      <div><strong>{data?.stats.importantEvents ?? "—"}</strong><span>AI 重要事件</span></div><div><strong>{data?.stats.creatorUpdates ?? "—"}</strong><span>博主新内容</span></div><div><strong>{data?.stats.deepLearning ?? "—"}</strong><span>值得深入学习</span></div><div><strong>{data?.stats.topicOpportunities ?? "—"}</strong><span>选题机会</span></div>
      <p><Clock3 size={14} />{data?.lastSyncedAt ? `最后同步 ${timeFormatter.format(new Date(data.lastSyncedAt))}` : "尚未完成首次内容同步"}</p>
    </section>
    <section className="v2-brief-section">
      <div className="v2-section-heading"><div><span>01</span><div><h2>3 分钟速览</h2><p>先形成判断，再决定今天把时间花在哪里。</p></div></div><button onClick={()=>document.querySelector(".v2-brief-grid")?.scrollIntoView({behavior:"smooth"})}><Sparkles size={15} />进入速览</button></div>
      {data?.brief.length ? <div className="v2-brief-grid">{data.brief.map((item) => <Link href={item.href} key={item.id}><small>{item.label}</small><strong>{item.title}</strong><p>{item.description}</p><ArrowRight size={17} /></Link>)}</div> : <div className="v2-inline-empty"><strong>{loading ? "正在读取今日简报…" : "今天的简报还没有生成"}</strong><p>完成来源同步后，系统会根据真实事件和博主内容生成，不会用固定文案补位。</p><Link href="/sources">检查来源 <ArrowRight size={16} /></Link></div>}
    </section>
    <section className="v2-editorial-section">
      <div className="v2-section-heading"><div><span>02</span><div><h2>AI 世界今天发生了什么</h2><p>同一事件合并展示，保留全部原始来源。</p></div></div><Link href="/ai-news">查看全部动态 <ArrowRight size={16} /></Link></div>
      {data?.events.length ? <div className="v2-event-list">{data.events.map((event) => <article key={event.id}><div className="v2-event-meta"><span className={`level-${event.level}`}>{event.level}</span><span>{event.category}</span><time>{event.publishedAt ? timeFormatter.format(new Date(event.publishedAt)) : "时间待确认"}</time></div><h3><Link href={`/ai-news?event=${event.id}`}>{event.title}</Link></h3><p>{event.happened ?? "来源尚未提供可核对的摘要。"}</p><dl><div><dt>真正变化</dt><dd>{event.realChange ?? "等待分析"}</dd></div><div><dt>为什么与你有关</dt><dd>{event.whyRelevant ?? "等待结合当前内容画像分析"}</dd></div></dl><footer><span>{event.evidence.length} 个真实来源</span>{event.primarySource?.url && <a href={event.primarySource.url} target="_blank" rel="noreferrer">查看一手来源 <ExternalLink size={14} /></a>}<Link href={`/ai-news?event=${event.id}`}>查看事件 <ArrowRight size={14} /></Link></footer></article>)}</div> : <div className="v2-inline-empty"><strong>{loading ? "正在读取真实事件…" : "这一天还没有可展示的 AI 事件"}</strong><p>这里不会自动混入 Demo；同步 AIHot 后，事件会按证据关系出现在这里。</p></div>}
    </section>
    <section className="v2-creator-section">
      <div className="v2-section-heading"><div><span>03</span><div><h2>我关注的博主今天发了什么</h2><p>先给推荐结论，再决定深入学习、快速浏览或忽略。</p></div></div><Link href="/creators">查看全部博主动态 <ArrowRight size={16} /></Link></div>
      {data?.creators.length ? <div className="v2-creator-row">{data.creators.slice(0,4).map((item) => <article key={item.id}><div className="v2-thumb">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span>暂无封面</span>}{duration(item.durationSeconds) && <time>{duration(item.durationSeconds)}</time>}</div><div className="v2-creator-meta"><span>{item.platform}</span><time>{item.publishedAt ? timeFormatter.format(new Date(item.publishedAt)) : "时间未知"}</time></div><h3>{item.title}</h3><p>{item.summary ?? "暂无内容摘要"}</p><footer><strong>{item.recommendation === "pending" ? "等待分析" : item.recommendation === "deep_learn" ? "建议深入学习" : item.recommendation === "quick_scan" ? "建议快速浏览" : item.recommendation === "topic_signal" ? "只作为选题信号" : "可以忽略"}</strong><Link href={`/learning/${item.id}`}>查看内容 <ArrowRight size={14} /></Link></footer></article>)}</div> : <div className="v2-inline-empty"><strong>{loading ? "正在读取博主更新…" : "这一天还没有同步到博主新内容"}</strong><p>YouTube 订阅频道和 Get 笔记竞品的具体内容同步后，会显示真实封面、作者、时间和原始链接。</p></div>}
    </section>
    <section className="v2-editorial-section"><div className="v2-section-heading"><div><span>04</span><div><h2>跨来源机会</h2><p>同一主题同时出现在不同来源时才会展示。</p></div></div><Link href="/ai-news">查看交叉证据 <ArrowRight size={16}/></Link></div>{data?.crossSignals.length?<div className="v2-cross-grid">{data.crossSignals.slice(0,3).map(signal=><article key={signal.id}><small>{signal.trendStatus} · {signal.windowLabel}</small><h3>{signal.title}</h3><p>AIHot {signal.aihotCount} · YouTube {signal.youtubeCount} · 国内竞品 {signal.competitorCount}</p><dl><dt>国内外表达差异</dt><dd>{signal.expressionDifference??"等待分析"}</dd><dt>差异化选题</dt><dd>{signal.differentiatedTopic??"等待分析"}</dd></dl></article>)}</div>:<div className="v2-inline-empty compact"><strong>暂时没有达到门槛的交叉信号</strong><p>单一来源不会被包装成跨平台趋势。</p></div>}</section>
  </div>;
}
