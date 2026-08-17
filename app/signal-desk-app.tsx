"use client";

import {
  Archive,
  ArrowRight,
  Bell,
  BookOpen,
  Bookmark,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Command,
  Compass,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Inbox,
  Layers3,
  Library,
  Lightbulb,
  Link2,
  ListFilter,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Upload,
  Wifi,
  X,
  Video,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { demoContent, demoTopics, knowledgeCards, transcriptSegments, verifiedCompetitors } from "../lib/demo-data";
import { getBrowserSupabase } from "../lib/supabase/client";
import type { ContentItem, PageKey, TopicCandidate, TopicStatus } from "../lib/types";
import { LoginScreen } from "./login-screen";

const navigation = [
  { key: "today" as const, label: "今日", icon: Compass },
  { key: "inbox" as const, label: "收件箱", icon: Inbox, count: 24 },
  { key: "learning" as const, label: "学习", icon: BookOpen, count: 6 },
  { key: "intelligence" as const, label: "情报", icon: TrendingUp },
  { key: "topics" as const, label: "选题", icon: Lightbulb, count: 3 },
  { key: "knowledge" as const, label: "知识库", icon: Library },
  { key: "review" as const, label: "复盘", icon: FileText },
];

const pageNames: Record<PageKey, string> = {
  today: "今日",
  inbox: "收件箱",
  learning: "学习",
  intelligence: "情报",
  topics: "选题",
  knowledge: "知识库",
  review: "每周复盘",
  sources: "来源中心",
  settings: "设置",
};

type Toast = { id: number; message: string } | null;

export function SignalDeskApp() {
  const [authState, setAuthState] = useState<"loading" | "demo" | "authenticated" | "unauthenticated">(
    process.env.NEXT_PUBLIC_SUPABASE_URL ? "loading" : "demo",
  );
  const [page, setPage] = useState<PageKey>("today");
  const [content, setContent] = useState<ContentItem[]>(() => {
    if (typeof window === "undefined") return demoContent;
    try { return (JSON.parse(window.localStorage.getItem("signal-desk-demo-state") ?? "{}") as { content?:ContentItem[] }).content ?? demoContent; }
    catch { return demoContent; }
  });
  const [topics, setTopics] = useState<TopicCandidate[]>(() => {
    if (typeof window === "undefined") return demoTopics;
    try { return (JSON.parse(window.localStorage.getItem("signal-desk-demo-state") ?? "{}") as { topics?:TopicCandidate[] }).topics ?? demoTopics; }
    catch { return demoTopics; }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [sourceConfigOpen, setSourceConfigOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => setAuthState(data.session ? "authenticated" : "unauthenticated"));
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setAuthState(session ? "authenticated" : "unauthenticated"));
      return () => listener.subscription.unsubscribe();
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "youtube") {
      const count = Number(params.get("subscriptions") ?? 0);
      queueMicrotask(() => {
        setPage("sources");
        setToast({ id:Date.now(),message:params.get("warning") === "sync" ? "YouTube 已授权，订阅导入可在来源页重试" : `YouTube 已连接，导入 ${count} 个订阅频道` });
      });
      window.history.replaceState({},"",window.location.pathname);
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("signal-desk-demo-state", JSON.stringify({ content, topics }));
  }, [content, topics]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setQuickAddOpen(false);
        setFocusOpen(false);
        setSourceConfigOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const notify = (message: string) => {
    const next = { id: Date.now(), message };
    setToast(next);
    window.setTimeout(() => setToast((current) => current?.id === next.id ? null : current), 2600);
  };

  const navigate = (next: PageKey) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateStatus = (id: string, status: ContentItem["status"]) => {
    setContent((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    notify(status === "queued_learning" ? "已加入学习列表" : status === "ignored" ? "已忽略，并用于调整推荐" : "状态已更新");
  };

  const updateTopicStatus = (id: string, status: TopicStatus) => {
    setTopics((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    notify(status === "confirmed" ? "选题已确认，证据与验证任务已保留" : "选题状态已更新");
  };

  if (authState === "loading") return <main className="auth-loading"><div className="brand-mark"><span /></div><p>正在打开你的工作区…</p></main>;
  if (authState === "unauthenticated") return <LoginScreen />;

  return (
    <main className={dark ? "signal-app dark" : "signal-app"}>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("today")} aria-label="返回今日">
          <div className="brand-mark"><span /></div>
          <div><strong>Signal Desk</strong><small>信号台</small></div>
        </button>
        <nav aria-label="主导航">
          {navigation.map((item) => (
            <button key={item.key} className={page === item.key ? "nav-item active" : "nav-item"} onClick={() => navigate(item.key)}>
              <item.icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.count && <em>{item.count}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className={page === "sources" ? "nav-item active" : "nav-item"} onClick={() => navigate("sources")}><Wifi size={18} /><span>来源</span></button>
          <button className={page === "settings" ? "nav-item active" : "nav-item"} onClick={() => navigate("settings")}><Settings size={18} /><span>设置</span></button>
          <div className="profile-row">
            <div className="avatar">W</div>
            <div><strong>我的工作区</strong><small>个人情报工作台</small></div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="菜单"><Menu size={20} /></button>
          <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={18} /><span>搜索信号、字幕、笔记与选题</span><kbd>⌘ K</kbd></button>
          <div className="top-actions">
            <span className="page-location">{pageNames[page]}</span>
            <button className="ghost-button" onClick={() => setQuickAddOpen(true)}><Plus size={16} />快速添加</button>
            <button className="icon-button" aria-label="通知" onClick={() => notify("当前没有需要立即处理的通知")}><Bell size={18} /></button>
          </div>
        </header>

        <div className="content product-content">
          {page === "today" && <TodayPage onFocus={() => setFocusOpen(true)} navigate={navigate} updateStatus={updateStatus} />}
          {page === "inbox" && <InboxPage items={content} updateStatus={updateStatus} navigate={navigate} />}
          {page === "learning" && <LearningPage notify={notify} />}
          {page === "intelligence" && <IntelligencePage notify={notify} navigate={navigate} />}
          {page === "topics" && <TopicsPage topics={topics} setTopics={setTopics} updateStatus={updateTopicStatus} notify={notify} />}
          {page === "knowledge" && <KnowledgePage notify={notify} navigate={navigate} />}
          {page === "review" && <ReviewPage navigate={navigate} />}
          {page === "sources" && <SourcesPage notify={notify} openConfig={() => setSourceConfigOpen(true)} />}
          {page === "settings" && <SettingsPage dark={dark} setDark={setDark} notify={notify} />}
        </div>
      </section>

      <nav className="mobile-bottom-nav" aria-label="移动端导航">
        {navigation.slice(0, 5).map((item) => <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => navigate(item.key)}><item.icon size={20} /><span>{item.label}</span></button>)}
      </nav>

      {searchOpen && <SearchDialog close={() => setSearchOpen(false)} navigate={navigate} />}
      {quickAddOpen && <QuickAddDialog close={() => setQuickAddOpen(false)} notify={notify} />}
      {focusOpen && <FocusSession close={() => setFocusOpen(false)} navigate={navigate} />}
      {sourceConfigOpen && <ConnectorDialog close={() => setSourceConfigOpen(false)} notify={notify} />}
      {toast && <div className="toast" role="status"><Check size={17} />{toast.message}</div>}
    </main>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function SectionTitle({ index, title, detail, action }: { index?: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="section-title"><div>{index && <span className="section-index">{index}</span>}<h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>;
}

function TodayPage({ onFocus, navigate, updateStatus }: { onFocus: () => void; navigate: (page: PageKey) => void; updateStatus: (id: string, status: ContentItem["status"]) => void }) {
  const [liveSignals, setLiveSignals] = useState<Array<{ title: string; summary: string | null; canonicalUrl: string | null; author: string | null }>>([]);
  const [liveState, setLiveState] = useState<"loading" | "live" | "fallback">("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/connectors/aihot/sync?window=24h&limit=3")
      .then((response) => response.json())
      .then((payload: unknown) => {
        if (!active) return;
        const data = payload as { ok?: boolean; items?: Array<{ title: string; summary: string | null; canonicalUrl: string | null; author: string | null }> };
        if (data.ok && Array.isArray(data.items)) {
          setLiveSignals(data.items);
          setLiveState("live");
        } else setLiveState("fallback");
      })
      .catch(() => active && setLiveState("fallback"));
    return () => { active = false; };
  }, []);

  const signals = liveState === "live" && liveSignals.length ? liveSignals : [
    { title: "同一 AI 事件已合并为一个信号", summary: "当前显示为 Demo Connector 数据；正式部署后会保留每条原始来源与事实边界。", canonicalUrl: null, author: "Demo Connector" },
    { title: "开源编程工具从代码补全转向完整工作流", summary: "行业关注点正从单次生成质量转向计划、执行、验证与交付闭环。", canonicalUrl: null, author: "Demo Connector" },
  ];

  return <>
    <PageHeading
      eyebrow="2026 年 8 月 17 日 · 星期一"
      title="早上好，今天有 3 件事值得你关注。"
      description="从 47 条新增内容中去重并筛出了 9 条高价值信号。"
      action={<button className="primary-button" onClick={onFocus}><CircleCheck size={18} />开始专注会话</button>}
    />
    <div className="metrics" aria-label="今日摘要">
      <div><strong>47</strong><span>今日新增</span></div><div><strong>21</strong><span>已去重</span></div><div><strong>4</strong><span>推荐学习</span></div><div><strong>3</strong><span>候选选题</span></div>
      <div className="progress-metric"><strong>1 / 3</strong><span>今日计划</span><i><b /></i></div>
    </div>
    <section className="priority-section">
      <SectionTitle index="01" title="今日三项" detail="先完成最值得投入的行动" action={<button className="text-button" onClick={onFocus}>调整计划</button>} />
      <div className="priority-grid">
        <article className="priority-card done"><div className="task-kicker"><span>已完成</span><small>情报 · 8 分钟</small></div><h3>理解一个重要 AI 事件的变化与影响</h3><p>3 个来源给出了可交叉核对的证据，已区分事实、解释与待确认内容。</p><button className="task-footer" onClick={() => navigate("intelligence")}><span><CircleCheck size={17} />已读事件</span><ChevronRight size={18} /></button></article>
        <article className="priority-card learning"><div className="task-kicker"><span>接下来</span><small>学习 · 24 分钟</small></div><h3>如何设计可长期运行的内容研究系统</h3><p>重点观看 08:12—16:40，拆解来源分级与去重判断方法。</p><button className="task-footer" onClick={() => { updateStatus("yt-01", "queued_learning"); navigate("learning"); }}><span><BookOpen size={17} />开始学习</span><ChevronRight size={18} /></button></article>
        <article className="priority-card topic"><div className="task-kicker"><span>待处理</span><small>选题 · 15 分钟</small></div><h3>验证“AI 日报不是越多越好”这个内容角度</h3><p>结合行业事件和你的真实使用记录，完成最小实测。</p><button className="task-footer" onClick={() => navigate("topics")}><span><Lightbulb size={17} />查看选题</span><ChevronRight size={18} /></button></article>
      </div>
    </section>
    <section className="signal-section">
      <SectionTitle index="02" title="今天值得知道" detail="同一事件已合并，保留不同证据" action={<button className="text-button" onClick={() => navigate("intelligence")}>查看全部 <ChevronRight size={16} /></button>} />
      <div className="live-status"><span className={liveState === "live" ? "status-dot online" : "status-dot"} />{liveState === "live" ? "AIHot 真实接口 · 刚刚更新" : liveState === "loading" ? "正在读取 AIHot 真实信号" : "Demo Connector · 真实接口暂不可用"}</div>
      <div className="signal-list">
        {signals.map((signal, index) => <article className="signal-row" key={`${signal.title}-${index}`}>
          <div className={index === 0 ? "signal-rank high" : "signal-rank"}>{index === 0 ? 92 : 84}</div>
          <div className="signal-main"><div className="signal-meta"><span>{index === 0 ? "高重要性" : "值得关注"}</span><time><Clock3 size={14} />{index + 2} 小时前</time><em>{index + 3} 个来源</em></div><h3>{signal.title}</h3><p>{signal.summary ?? "来源没有提供摘要，请打开原文核对。"}</p><div className="why"><strong>证据边界</strong>{signal.author ?? "来源待核对"} · 结论需要回到原始来源确认</div></div>
          {signal.canonicalUrl ? <a className="row-action" href={signal.canonicalUrl} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={15} /></a> : <button className="row-action" onClick={() => navigate("intelligence")}>查看证据 <ChevronRight size={17} /></button>}
        </article>)}
      </div>
    </section>
    <section className="two-column-section">
      <div><SectionTitle index="03" title="今天值得学习" detail="只推荐能形成输出的内容" /><article className="learning-recommendation"><div className="video-placeholder"><Video size={28} /><span>24:18</span></div><div><span className="source-label">YouTube · 系统提炼</span><h3>How I Built a Research System That Compounds</h3><p>推荐片段 08:12—16:40 · 预计学习 24 分钟</p><button className="secondary-button" onClick={() => navigate("learning")}>进入学习页 <ArrowRight size={16} /></button></div></article></div>
      <div><SectionTitle index="04" title="今日选题" detail="最多三个不同方向" /><div className="mini-topic-list">{demoTopics.slice(0, 2).map((topic) => <button key={topic.id} onClick={() => navigate("topics")}><span>{topic.type}</span><strong>{topic.topic}</strong><em>{topic.score}/10</em></button>)}</div></div>
    </section>
  </>;
}

function InboxPage({ items, updateStatus, navigate }: { items: ContentItem[]; updateStatus: (id: string, status: ContentItem["status"]) => void; navigate: (page: PageKey) => void }) {
  const [source, setSource] = useState("全部来源");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [view, setView] = useState<"list" | "compact">("list");
  const filtered = items.filter((item) => (source === "全部来源" || item.source === source) && (!onlyUnread || item.status === "unread"));
  return <>
    <PageHeading eyebrow="统一处理入口" title="收件箱" description="先判断价值，再决定归档、学习或转为选题。" action={<button className="secondary-button"><RefreshCw size={16} />重新分析</button>} />
    <div className="filterbar"><div className="filter-group"><Filter size={16} /><select value={source} onChange={(e) => setSource(e.target.value)}><option>全部来源</option><option>YouTube</option><option>AIHot</option><option>Get 笔记</option></select><button className={onlyUnread ? "filter-chip active" : "filter-chip"} onClick={() => setOnlyUnread(!onlyUnread)}>仅未读</button><button className="filter-chip">评分 ≥ 75</button><button className="filter-chip">最近 7 天</button></div><div className="view-toggle"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><Layers3 size={16} /></button><button className={view === "compact" ? "active" : ""} onClick={() => setView("compact")}><ListFilter size={16} /></button></div></div>
    <div className={view === "compact" ? "inbox-list compact" : "inbox-list"}>
      {filtered.map((item) => <article className="inbox-item" key={item.id}>
        <div className={`source-icon ${item.sourceType}`}>{item.sourceType === "youtube" ? <Video size={20} /> : item.sourceType === "aihot" ? <Zap size={20} /> : <FileText size={20} />}</div>
        <div className="inbox-copy"><div className="item-meta"><span>{item.source}</span><i>·</i><span>{item.author}</span><i>·</i><span>{item.publishedAt}</span>{item.provenance === "verified_live" && <em>真实连接</em>}</div><h3>{item.title}</h3><p>{item.summary}</p><div className="tags">{item.topics.map((topic) => <span key={topic}>{topic}</span>)}{item.hasTranscript && <span>有字幕</span>}{item.duration && <span>{item.duration}</span>}</div></div>
        <div className="score-stack"><strong>{item.score}</strong><span>信号分</span><small>学习 {item.learningScore}</small><small>选题 {item.topicScore}</small></div>
        <div className="item-actions"><button title="收藏" onClick={() => updateStatus(item.id, "saved")}><Bookmark size={17} /></button>{item.sourceType === "youtube" && <button title="加入学习" onClick={() => { updateStatus(item.id, "queued_learning"); navigate("learning"); }}><BookOpen size={17} /></button>}<button title="归档" onClick={() => updateStatus(item.id, "archived")}><Archive size={17} /></button><button title="忽略" onClick={() => updateStatus(item.id, "ignored")}><X size={17} /></button></div>
      </article>)}
      {!filtered.length && <EmptyState icon={<Inbox size={28} />} title="没有符合条件的内容" detail="试试取消一个筛选条件。" />}
    </div>
  </>;
}

function LearningPage({ notify }: { notify: (message: string) => void }) {
  const [tab, setTab] = useState<"transcript" | "analysis" | "notes" | "quiz">("transcript");
  const [selected, setSelected] = useState("s3");
  const [note, setNote] = useState("这个判断适合用来复盘我的 AI 资讯来源：更新多，不等于真正改变行动。");
  const [goal, setGoal] = useState("apply_to_project");
  const [quizAnswered, setQuizAnswered] = useState(false);
  const activeSegment = transcriptSegments.find((segment) => segment.id === selected) ?? transcriptSegments[0];
  return <>
    <PageHeading eyebrow="学习中 · 38%" title="如何设计可长期运行的内容研究系统" description="Build in Public · 24:18 · 字幕来源：Demo Transcript Provider" action={<select className="goal-select" value={goal} onChange={(e) => setGoal(e.target.value)}><option value="understand">理解内容</option><option value="reproduce">复现方法</option><option value="apply_to_project">应用到项目</option><option value="create_content">形成内容</option><option value="study_creator_method">研究作者方法</option></select>} />
    <div className="learning-layout">
      <section className="player-column"><div className="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?rel=0" title="YouTube 学习播放器" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div><div className="player-controls"><button onClick={() => notify("播放位置已记录")}><Play size={17} />恢复到 09:12</button><span>字幕跟随已开启</span><button onClick={() => notify("已标记当前片段作为证据")}><Bookmark size={17} />标记片段</button></div><div className="chapter-strip"><button>00:00 为什么多数系统会失败</button><button className="active">08:12 来源分级</button><button>16:40 每周复盘</button></div></section>
      <section className="learning-panel"><div className="tabs">{(["transcript","analysis","notes","quiz"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "transcript" ? "时间轴字幕" : item === "analysis" ? "深度学习" : item === "notes" ? "我的笔记" : "测试"}</button>)}</div>
        {tab === "transcript" && <div className="transcript-panel"><div className="panel-toolbar"><Search size={15} /><span>搜索字幕</span><button>中英对照</button></div>{transcriptSegments.map((segment) => <button className={selected === segment.id ? "transcript-line active" : "transcript-line"} key={segment.id} onClick={() => setSelected(segment.id)}><time>{segment.time}</time><span><strong>{segment.text}</strong><em>{segment.zh}</em></span></button>)}</div>}
        {tab === "analysis" && <div className="analysis-panel"><div className="system-label">系统提炼 · 基于字幕证据</div><AnalysisBlock title="问题定义" text="收藏与输入越来越多，但没有形成可以复用的判断和行动。" refs={["02:34", "08:12"]} /><AnalysisBlock title="核心主张" text="研究系统的产出不是摘要，而是问题、规则、测试或决策。" refs={["21:18"]} /><AnalysisBlock title="方法步骤" text="1. 将信号与知识分开；2. 合并同一事件；3. 以是否改变行动评估来源；4. 每周移除无效来源。" refs={["02:34", "12:46", "16:40"]} /><AnalysisBlock title="适用边界" text="适合需要长期跟踪主题的人；不适合一次性资料搜索。作者经验不等于已验证事实。" refs={["16:40"]} /><button className="secondary-button" onClick={() => notify("已从分析生成 2 张知识卡草稿")}><Library size={16} />生成知识卡草稿</button></div>}
        {tab === "notes" && <div className="notes-panel"><div className="note-type-row"><button className="active">自己的判断</button><button>怀疑</button><button>反对</button><button>待验证</button></div><div className="quote-block"><time>{activeSegment.time}</time><p>{activeSegment.zh}</p></div><textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Markdown 笔记" /><div className="note-actions"><span>支持 Markdown · 自动保存到 Demo 工作区</span><button className="primary-button small" onClick={() => notify("笔记已保存，并关联当前时间戳")}>保存笔记</button></div></div>}
        {tab === "quiz" && <div className="quiz-panel"><span className="quiz-count">场景题 1 / 4</span><h3>如果一个来源每天更新很多，但一个月内没有改变过你的任何行动，按作者的方法应该怎么处理？</h3><label><input type="radio" name="quiz" />提高权重，因为更新频率高</label><label><input type="radio" name="quiz" />继续观察，不改变任何设置</label><label><input type="radio" name="quiz" onChange={() => setQuizAnswered(true)} />降低权重或移除，并记录这次判断</label><button className="primary-button" disabled={!quizAnswered} onClick={() => notify("回答正确；建议回看 16:40")}>提交并批改</button>{quizAnswered && <div className="quiz-feedback"><CircleCheck size={18} /><p><strong>理解方向正确。</strong>依据原视频 16:40，评价来源要看它是否带来决策，而不是看更新频率。</p></div>}</div>}
      </section>
    </div>
    <div className="learning-output-bar"><div><strong>完成学习需要留下一个输出</strong><span>知识卡、用户判断、实践任务、候选选题或完成测试</span></div><button onClick={() => notify("已创建实践任务：复盘 7 天来源采用率")}><CircleCheck size={17} />创建实践任务</button><button onClick={() => notify("已保存知识卡：来源有效性的最终标准")}><Library size={17} />保存知识卡</button></div>
  </>;
}

function AnalysisBlock({ title, text, refs }: { title: string; text: string; refs: string[] }) {
  return <section><h3>{title}</h3><p>{text}</p><div className="evidence-refs">{refs.map((ref) => <button key={ref}>{ref}</button>)}</div></section>;
}

function IntelligencePage({ notify, navigate }: { notify: (message: string) => void; navigate: (page: PageKey) => void }) {
  const [tab, setTab] = useState<"events" | "competitors" | "trends">("events");
  return <>
    <PageHeading eyebrow="多源证据与竞品信号" title="情报" description="事实、作者观点、系统推断和你的判断被明确分开。" action={<button className="secondary-button" onClick={() => notify("已按 72 小时窗口刷新候选事件")}><RefreshCw size={16} />刷新 72 小时</button>} />
    <div className="subnav"><button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>AIHot 事件</button><button className={tab === "competitors" ? "active" : ""} onClick={() => setTab("competitors")}>竞品账号</button><button className={tab === "trends" ? "active" : ""} onClick={() => setTab("trends")}>趋势</button></div>
    {tab === "events" && <div className="event-grid"><article className="event-detail"><div className="event-heading"><span className="score-badge">92</span><div><div className="item-meta"><span>4 个来源</span><i>·</i><span>最近更新 2 小时前</span></div><h2>AI 产品竞争开始转向长任务可靠性</h2><p>变化不只在基准分数，而在失败恢复、上下文保持和结果验证。</p></div></div><div className="fact-columns"><section><h3><ShieldCheck size={16} />已确认事实</h3><ul><li>多个产品更新都强调长任务执行和工具协作。</li><li>公开示例开始展示失败恢复与中间结果检查。</li></ul></section><section><h3><MessageSquareText size={16} />不同解释</h3><ul><li>媒体认为竞争点从模型能力转向系统工程。</li><li>作者观点：这会降低复杂工作流的维护成本。</li></ul></section><section className="uncertain"><h3><CircleAlert size={16} />尚未确认</h3><ul><li>不同产品的长任务成功率暂无统一公开评测。</li></ul></section></div><div className="event-sources"><strong>证据来源</strong>{["官方产品更新", "开发者文档", "独立评测", "AIHot 聚合页"].map((source, i) => <button key={source}><span>{i + 1}</span>{source}<ExternalLink size={14} /></button>)}</div><div className="event-actions"><button className="secondary-button" onClick={() => notify("事件已保存")}>保存事件</button><button className="primary-button" onClick={() => navigate("topics")}>转为选题</button></div></article><aside className="event-aside"><h3>为什么与你有关</h3><p>你正在搭建内容自动化流程，可靠性变化会影响哪些步骤值得交给智能体。</p><h3>相关主题</h3><div className="tags"><span>AI 智能体</span><span>工作流</span><span>可靠性</span></div><h3>你的判断</h3><textarea placeholder="写下自己的判断，不会与系统结论混在一起" /><button className="secondary-button" onClick={() => notify("你的判断已保存")}>保存判断</button></aside></div>}
    {tab === "competitors" && <><div className="data-boundary"><ShieldCheck size={18} /><p><strong>数据边界</strong> 下列账号来自本机 Get 笔记真实只读连接；互动字段未读取，因此只显示“内容信号”，不判断爆款或增长速度。</p></div><div className="competitor-grid">{verifiedCompetitors.map((item) => <article key={item.name}><div className="competitor-avatar">{item.name.slice(0,1)}</div><div><span>{item.platform} · {item.signal}</span><h3>{item.name}</h3></div><em>{item.trend}</em><div className="tags">{item.topics.map((topic) => <span key={topic}>{topic}</span>)}</div><dl><div><dt>最近变化</dt><dd>实操与具体场景标题增加</dd></div><div><dt>数据完整度</dt><dd>内容可读 · 互动缺失</dd></div></dl><button className="secondary-button" onClick={() => notify(`已打开 ${item.name} 的证据列表`)}>查看内容证据</button></article>)}</div></>}
    {tab === "trends" && <div className="trend-table"><div className="table-head"><span>主题</span><span>状态</span><span>7 天内容</span><span>涉及账号</span><span>证据</span></div>{[["AI 小白工作流","emerging","12","5"],["AI 视频实操","rising","18","7"],["工具选择焦虑","stable","9","4"],["纯提示词合集","declining","5","3"]].map((row) => <div className="table-row" key={row[0]}><strong>{row[0]}</strong><span className={`trend-state ${row[1]}`}>{row[1]}</span><span>{row[2]}</span><span>{row[3]}</span><button onClick={() => notify("已打开对应原文列表")}>查看原文</button></div>)}</div>}
  </>;
}

function TopicsPage({ topics, setTopics, updateStatus, notify }: { topics: TopicCandidate[]; setTopics: React.Dispatch<React.SetStateAction<TopicCandidate[]>>; updateStatus: (id: string, status: TopicStatus) => void; notify: (message: string) => void }) {
  const [view, setView] = useState<"board" | "list">("board");
  const [selected, setSelected] = useState<TopicCandidate | null>(null);
  const generate = () => {
    const exists = topics.some((topic) => topic.id === "topic-generated");
    if (!exists) setTopics((items) => [...items, { ...demoTopics[2], id: "topic-generated", topic: "我用一个真实事件测试了 AI 情报系统的四层闭环", status: "candidate", type: "实测型", similarity: 6 }]);
    notify("已生成 1 个新方向；没有对原标题做同义改写");
  };
  const groups: Array<{ status: TopicStatus; label: string }> = [{ status: "candidate", label: "候选" }, { status: "researching", label: "研究中" }, { status: "testing", label: "实测中" }, { status: "confirmed", label: "已确认" }];
  return <>
    <PageHeading eyebrow="证据驱动的内容决策" title="选题工作台" description="每次最多三个方向；正式立项前必须保留证据、差异与最小实测。" action={<button className="primary-button" onClick={generate}><Plus size={17} />生成候选选题</button>} />
    <div className="topic-toolbar"><div><button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>看板</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>列表</button></div><span>制作中 0 / 1</span><button className="filter-chip"><Filter size={15} />筛选</button></div>
    {view === "board" ? <div className="topic-board">{groups.map((group) => <section key={group.status}><header><strong>{group.label}</strong><span>{topics.filter((topic) => topic.status === group.status).length}</span></header>{topics.filter((topic) => topic.status === group.status).map((topic) => <TopicCard key={topic.id} topic={topic} onOpen={() => setSelected(topic)} />)}{!topics.some((topic) => topic.status === group.status) && <div className="empty-column">暂无选题</div>}</section>)}</div> : <div className="topic-list-view">{topics.map((topic) => <TopicCard key={topic.id} topic={topic} onOpen={() => setSelected(topic)} />)}</div>}
    {selected && <dialog open className="drawer-backdrop"><button className="backdrop-dismiss" aria-label="关闭选题详情" onClick={() => setSelected(null)} /><aside className="topic-drawer"><button className="drawer-close" onClick={() => setSelected(null)}><X size={18} /></button><span className="topic-type">{selected.type}</span><h2>{selected.topic}</h2><div className="topic-score"><strong>{selected.score}</strong><span>/10 五维得分</span><em>历史重复 {selected.similarity}%</em></div><dl><div><dt>目标人群</dt><dd>{selected.audience}</dd></div><div><dt>一句话痛点</dt><dd>{selected.painPoint}</dd></div><div><dt>差异化角度</dt><dd>{selected.angle}</dd></div><div><dt>为什么现在做</dt><dd>{selected.whyNow}</dd></div><div><dt>最小实测任务</dt><dd>{selected.validationTask}</dd></div></dl><section className="evidence-summary"><h3><Link2 size={16} />来源证据 · {selected.evidenceCount}</h3><p>2 个 AIHot 事件 · 1 个视频片段 · 2 条竞品内容 · 1 条用户判断</p></section><div className="drawer-actions"><button className="secondary-button" onClick={() => notify("已进入研究状态")}>继续研究</button><button className="primary-button" onClick={() => { updateStatus(selected.id, "confirmed"); setSelected({ ...selected, status: "confirmed" }); }}>确认选题</button></div></aside></dialog>}
  </>;
}

function TopicCard({ topic, onOpen }: { topic: TopicCandidate; onOpen: () => void }) {
  return <button className="topic-card" onClick={onOpen}><div className="topic-card-top"><span>{topic.type}</span><em>{topic.score}/10</em></div><h3>{topic.topic}</h3><p>{topic.angle}</p><div className="topic-card-bottom"><span><Link2 size={14} />{topic.evidenceCount} 条证据</span><span>重复 {topic.similarity}%</span></div></button>;
}

function KnowledgePage({ notify, navigate }: { notify: (message: string) => void; navigate: (page: PageKey) => void }) {
  const [query, setQuery] = useState("");
  const filtered = knowledgeCards.filter((card) => `${card.title}${card.body}${card.tags.join("")}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageHeading eyebrow="可复用的个人判断" title="知识库" description="知识卡保留适用场景、前提、来源和使用记录。" action={<button className="primary-button" onClick={() => notify("已创建空白知识卡")}>新建知识卡</button>} />
    <div className="knowledge-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索概念、方法、判断规则或案例" /><button><SlidersHorizontal size={16} />筛选</button></div>
    <div className="knowledge-layout"><aside><strong>卡片类型</strong>{["全部卡片  24","概念  5","方法  6","判断规则  4","案例  3","工具  2","警告  3","反例  1"].map((item, index) => <button className={index === 0 ? "active" : ""} key={item}>{item}</button>)}<strong>待复习</strong><button>本周到期  6</button></aside><div className="knowledge-grid">{filtered.map((card) => <article key={card.id}><div className="knowledge-meta"><span>{card.type}</span><em>可信度 {card.confidence}</em></div><h3>{card.title}</h3><p>{card.body}</p><div className="tags">{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><footer><span><Link2 size={14} />{card.sources} 个来源</span><div><button title="复制" onClick={() => { navigator.clipboard.writeText(card.body); notify("知识卡内容已复制"); }}><Copy size={15} /></button><button title="转为选题" onClick={() => navigate("topics")}><Lightbulb size={15} /></button></div></footer></article>)}</div></div>
  </>;
}

function ReviewPage({ navigate }: { navigate: (page: PageKey) => void }) {
  return <>
    <PageHeading eyebrow="8 月 10 日—8 月 16 日" title="本周复盘" description="不是统计收藏数量，而是判断哪些来源和主题真正改变了行动。" action={<button className="secondary-button"><Upload size={16} />导出 Markdown</button>} />
    <div className="review-metrics">{[["新增内容","286","+12%"],["处理率","68%","+9%"],["深入学习","4","+1"],["知识卡","11","+5"],["实践完成","2","—"],["进入制作","1","—"],["AI 成本","$3.82","-18%"]].map((metric) => <div key={metric[0]}><span>{metric[0]}</span><strong>{metric[1]}</strong><em>{metric[2]}</em></div>)}</div>
    <div className="review-grid"><section className="review-chart"><SectionTitle title="来源采用率" detail="打开、学习或形成选题才算采用" /><div className="bar-list">{[["YouTube",78],["AIHot",64],["Get 笔记",51],["RSS",18]].map(([label,value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}%</strong></div>)}</div></section><section className="review-chart"><SectionTitle title="主题采用率" detail="长期行为反馈" /><div className="bar-list">{[["AI 工作流",82],["内容系统",71],["AI 视频",58],["提示词",23]].map(([label,value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}%</strong></div>)}</div></section></div>
    <section className="review-advice"><SectionTitle title="下周建议" detail="依据本周真实操作，而不是泛化建议" /><div className="advice-grid"><article><TrendingUp size={19} /><h3>保留并提高权重</h3><p>YouTube 里的研究系统与工作流内容采用率最高，建议继续优先。</p><button onClick={() => navigate("sources")}>调整来源</button></article><article><TrendingDown size={19} /><h3>考虑静音</h3><p>2 个 RSS 来源带来 42 条内容，但没有一次打开或保存。</p><button onClick={() => navigate("sources")}>查看来源</button></article><article><Lightbulb size={19} /><h3>继续验证</h3><p>“AI 摘要越好，可能学得越少”已有 4 条证据，仍缺一次对照测试。</p><button onClick={() => navigate("topics")}>查看选题</button></article></div></section>
  </>;
}

function SourcesPage({ notify, openConfig }: { notify: (message: string) => void; openConfig: () => void }) {
  const [aihotStatus, setAihotStatus] = useState<"ready" | "syncing" | "error">("ready");
  const [youtubeStatus, setYoutubeStatus] = useState<{ loading:boolean;connected:boolean;subscriptionCount:number;lastError:string|null }>({ loading:true,connected:false,subscriptionCount:0,lastError:null });
  const loadYoutubeStatus = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) { setYoutubeStatus({ loading:false,connected:false,subscriptionCount:0,lastError:null }); return; }
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setYoutubeStatus({ loading:false,connected:false,subscriptionCount:0,lastError:null }); return; }
    try {
      const response = await fetch("/api/connections/youtube/status",{ headers:{ Authorization:`Bearer ${data.session.access_token}` } });
      const payload = await response.json() as { connected?:boolean;subscriptionCount?:number;lastError?:string|null };
      setYoutubeStatus({ loading:false,connected:Boolean(payload.connected),subscriptionCount:payload.subscriptionCount ?? 0,lastError:payload.lastError ?? null });
    } catch { setYoutubeStatus({ loading:false,connected:false,subscriptionCount:0,lastError:"状态读取失败" }); }
  };
  useEffect(() => { void loadYoutubeStatus(); }, []);
  const syncAihot = async () => {
    setAihotStatus("syncing");
    try { const response = await fetch("/api/connectors/aihot/sync?limit=1"); const payload = await response.json() as { ok?: boolean }; if (!payload.ok) throw new Error(); setAihotStatus("ready"); notify("AIHot 真实接口同步成功"); } catch { setAihotStatus("error"); notify("AIHot 同步失败，可查看错误详情后重试"); }
  };
  const connectYoutube = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) { notify("Demo 模式未配置 Supabase 与 Google OAuth Client"); return; }
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/connections/youtube/start",{ method:"POST",headers:{ Authorization:`Bearer ${data.session?.access_token ?? ""}` } });
    const payload = await response.json() as { url?:string;error?:string };
    if (payload.url) window.location.assign(payload.url); else notify(payload.error ?? "YouTube 授权未能开始");
  };
  const syncYoutube = async () => {
    if (!youtubeStatus.connected) { await connectYoutube(); return; }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    setYoutubeStatus((current) => ({ ...current,loading:true }));
    try {
      const response = await fetch("/api/connections/youtube/sync",{ method:"POST",headers:{ Authorization:`Bearer ${data.session?.access_token ?? ""}` } });
      const payload = await response.json() as { ok?:boolean;subscriptionCount?:number;error?:string;requiresReauth?:boolean };
      if (payload.requiresReauth) {
        setYoutubeStatus((current) => ({ ...current,loading:false,connected:false,lastError:payload.error ?? "YouTube 授权已过期，请重新授权" }));
        notify(payload.error ?? "YouTube 授权已过期，请重新授权");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "同步失败");
      setYoutubeStatus({ loading:false,connected:true,subscriptionCount:payload.subscriptionCount ?? 0,lastError:null });
      notify(`YouTube 订阅同步成功，共 ${payload.subscriptionCount ?? 0} 个频道`);
    } catch (error) {
      setYoutubeStatus((current) => ({ ...current,loading:false,lastError:error instanceof Error ? error.message : "同步失败" }));
      notify(error instanceof Error ? error.message : "YouTube 同步失败");
    }
  };
  const connectedSourceCount = 2 + (youtubeStatus.connected && !youtubeStatus.lastError ? 1 : 0);
  const pendingSourceCount = youtubeStatus.loading || !youtubeStatus.connected ? 1 : 0;
  const failedSourceCount = (aihotStatus === "error" ? 1 : 0) + (youtubeStatus.lastError ? 1 : 0);
  const syncRows = [
    ["AIHot","10:42:08","8","8",aihotStatus === "error" ? "失败" : "成功"],
    ["Get 笔记","10:31:22","8 账号","8","本机验证"],
    ...(youtubeStatus.connected ? [["YouTube","刚刚",String(youtubeStatus.subscriptionCount),String(youtubeStatus.subscriptionCount),youtubeStatus.lastError ? "需重试" : "成功"]] : []),
    ["Demo Connector","08:00:02","47","47","成功"],
  ];
  return <>
    <PageHeading eyebrow="连接、映射与健康状态" title="来源中心" description="每个来源独立同步、独立失败；原始响应可重放，字段映射有版本。" action={<button className="primary-button" onClick={openConfig}><Plus size={17} />添加来源</button>} />
    <div className="source-summary"><div><span className="status-dot online" /><strong>{connectedSourceCount}</strong><small>真实可读</small></div><div><span className="status-dot pending" /><strong>{pendingSourceCount}</strong><small>待授权</small></div><div><span className="status-dot" /><strong>{failedSourceCount}</strong><small>失败</small></div><div><Clock3 size={18} /><strong>08:00</strong><small>下次计划同步</small></div></div>
    <div className="source-cards">
      <SourceCard icon={<Zap />} name="AIHot" type="AI 资讯" status={aihotStatus === "ready" ? "已连接 · 真实接口" : aihotStatus === "syncing" ? "正在同步" : "同步失败"} health={aihotStatus === "error" ? "error" : "good"} detail="匿名只读 v1 API · 24 小时窗口 · 事件聚类" stats={[["最近同步", "刚刚"], ["本次新增", "3"]]} onSync={syncAihot} />
      <SourceCard icon={<FileText />} name="Get 笔记" type="竞品知识库" status="已连接 · 本机验证" health="good" detail="Ai 自媒体对标博主 · 只读 · 互动为空不推断热度" stats={[["已识别账号", "8+"], ["日读取额度", "20,000"]]} onSync={() => notify("Get 笔记本机凭证可用；云端部署需配置 Token 与字段映射")} />
      <SourceCard icon={<Video />} name="YouTube" type="订阅与公开视频" status={youtubeStatus.loading ? "正在检查" : youtubeStatus.connected ? youtubeStatus.lastError ? "已连接 · 同步需重试" : "已连接 · 官方只读接口" : "等待授权"} health={youtubeStatus.lastError ? "error" : youtubeStatus.connected ? "good" : "pending"} detail={youtubeStatus.lastError ?? "只读订阅 · uploads playlist 增量 · 字幕 Provider 独立"} stats={[["订阅频道", youtubeStatus.connected ? String(youtubeStatus.subscriptionCount) : "—"], ["授权范围", "只读"]]} onSync={syncYoutube} actionLabel={youtubeStatus.connected ? "同步订阅" : "连接 YouTube"} />
      <SourceCard icon={<Database />} name="Demo Connector" type="完整演示数据" status="已启用" health="good" detail="外部凭证缺失时演示同步、学习、知识与选题完整流程" stats={[["演示记录", "47"], ["状态", "可重置"]]} onSync={() => notify("Demo 数据已重置并重新生成今日简报")} />
    </div>
    <section className="sync-log"><SectionTitle title="最近同步" detail="原始数据、标准化与任务状态分开记录" /><div className="table-head"><span>来源</span><span>开始时间</span><span>原始</span><span>标准化</span><span>状态</span></div>{syncRows.map((row) => <div className="table-row" key={row[0]}>{row.map((cell, i) => i === 4 ? <span className="success-text" key={cell}>{cell}</span> : <span key={cell}>{cell}</span>)}</div>)}</section>
  </>;
}

function SourceCard({ icon, name, type, status, health, detail, stats, onSync, actionLabel = "手动同步" }: { icon: React.ReactNode; name: string; type: string; status: string; health: "good" | "pending" | "error"; detail: string; stats: [string,string][]; onSync: () => void; actionLabel?: string }) {
  return <article className="source-card"><div className="source-card-heading"><div className={`source-logo ${health}`}>{icon}</div><div><span>{type}</span><h3>{name}</h3></div><em className={health}>{status}</em></div><p>{detail}</p><dl>{stats.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><footer><button className="secondary-button" onClick={onSync}><RefreshCw size={15} />{actionLabel}</button><button className="icon-button" title="来源设置"><Settings size={16} /></button></footer></article>;
}

function SettingsPage({ dark, setDark, notify }: { dark: boolean; setDark: (value: boolean) => void; notify: (message: string) => void }) {
  const [dailyLimit, setDailyLimit] = useState(3);
  return <>
    <PageHeading eyebrow="个人工作区" title="设置" description="控制内容画像、模型、成本、通知和数据边界。" action={<button className="primary-button" onClick={() => notify("设置已保存")}>保存设置</button>} />
    <div className="settings-layout"><aside>{["内容画像","推荐与时区","AI 与成本","字幕服务","通知","数据与隐私"].map((item, i) => <button className={i === 0 ? "active" : ""} key={item}>{item}</button>)}</aside><div className="settings-main">
      <section><h2>内容画像</h2><p>所有新分析读取当前画像版本；更新后可重新评分未处理内容。</p><div className="form-grid"><label><span>身份</span><input defaultValue="AI 内容创作者 / 独立开发者" /></label><label><span>目标人群</span><input defaultValue="想用 AI 提升工作与创作效率的普通人" /></label><label className="full"><span>内容方向</span><textarea defaultValue="AI 工具真实实测、内容自动化、个人知识与选题系统" /></label><label className="full"><span>判断内容价值的标准</span><textarea defaultValue="能改变具体行动；有可验证证据；适合真实演示；不是同一事件的重复转述。" /></label></div><div className="topic-weights"><strong>主题权重</strong>{[["AI 工作流",88],["内容系统",82],["AI 视频",68],["纯提示词",22]].map(([name,value]) => <label key={String(name)}><span>{name}</span><input type="range" min="0" max="100" defaultValue={value} /><em>{value}</em></label>)}</div></section>
      <section><h2>推荐与界面</h2><div className="setting-row"><div><strong>每日明确行动</strong><p>今日页面默认保持克制。</p></div><div className="stepper"><button onClick={() => setDailyLimit(Math.max(1,dailyLimit-1))}>−</button><span>{dailyLimit}</span><button onClick={() => setDailyLimit(Math.min(5,dailyLimit+1))}>＋</button></div></div><div className="setting-row"><div><strong>深色主题</strong><p>跟随你的偏好，不改变信息层级。</p></div><button className={dark ? "switch on" : "switch"} onClick={() => setDark(!dark)} aria-label="切换深色主题"><span /></button></div><div className="setting-row"><div><strong>时区</strong><p>今日简报与周复盘使用此时区。</p></div><select defaultValue="Asia/Shanghai"><option>Asia/Shanghai</option><option>America/Los_Angeles</option></select></div></section>
      <section><h2>AI 与成本</h2><div className="setting-row"><div><strong>月度成本上限</strong><p>达到 80% 时提醒，达到上限后暂停非必要深度分析。</p></div><div className="cost-input">$ <input defaultValue="20" /></div></div><div className="cost-progress"><i><b /></i><span>本月 $3.82 / $20.00</span></div></section>
      <section className="danger-zone"><h2>数据与隐私</h2><div className="setting-row"><div><strong>导出全部数据</strong><p>包含 JSON、Markdown 与 CSV，不包含解密后的 Token。</p></div><button className="secondary-button" onClick={() => notify("导出任务已创建")}>创建导出</button></div><div className="setting-row"><div><strong>删除账户</strong><p>需要二次确认；该操作当前不会在 Demo 模式执行。</p></div><button className="danger-button" onClick={() => notify("Demo 模式不会删除任何账户")}>删除账户</button></div></section>
    </div></div>
  </>;
}

function SearchDialog({ close, navigate }: { close: () => void; navigate: (page: PageKey) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return [
      ...demoContent.filter((item) => `${item.title}${item.summary}`.toLowerCase().includes(q)).map((item) => ({ type: item.source, title: item.title, page: item.sourceType === "youtube" ? "learning" as const : "inbox" as const })),
      ...demoTopics.filter((item) => `${item.topic}${item.angle}`.toLowerCase().includes(q)).map((item) => ({ type: "选题", title: item.topic, page: "topics" as const })),
      ...knowledgeCards.filter((item) => `${item.title}${item.body}`.toLowerCase().includes(q)).map((item) => ({ type: "知识卡", title: item.title, page: "knowledge" as const })),
    ];
  }, [query]);
  return <dialog open className="modal-backdrop"><button className="backdrop-dismiss" aria-label="关闭搜索" onClick={close} /><section className="command-dialog"><div className="command-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文、字幕、笔记、知识卡和选题" /><kbd>Esc</kbd></div>{query ? <div className="search-results">{results.map((result, i) => <button key={`${result.title}-${i}`} onClick={() => { navigate(result.page); close(); }}><span>{result.type}</span><strong>{result.title}</strong><ChevronRight size={16} /></button>)}{!results.length && <p>没有找到结果，换个关键词试试。</p>}</div> : <div className="command-groups"><span>快捷操作</span><button onClick={() => { navigate("inbox"); close(); }}><Inbox size={17} />打开收件箱<kbd>G I</kbd></button><button onClick={() => { navigate("topics"); close(); }}><Lightbulb size={17} />打开选题工作台<kbd>G T</kbd></button><button onClick={() => { navigate("sources"); close(); }}><Wifi size={17} />检查来源健康<kbd>G S</kbd></button></div>}<footer><span><Command size={14} />以证据为中心的混合搜索</span><span>PostgreSQL FTS + pgvector</span></footer></section></dialog>;
}

function QuickAddDialog({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const [url, setUrl] = useState("");
  return <dialog open className="modal-backdrop"><button className="backdrop-dismiss" aria-label="关闭快速添加" onClick={close} /><section className="small-dialog"><button className="drawer-close" onClick={close}><X size={18} /></button><span className="dialog-kicker">快速添加</span><h2>保存一个外部信号</h2><p>链接先进入收件箱，系统不会在保存前自动执行高成本分析。</p><label><span>公开链接</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label><label><span>你的判断（可选）</span><textarea placeholder="为什么想保存它？" /></label><button className="primary-button" disabled={!url} onClick={() => { notify("链接已加入收件箱，等待标准化"); close(); }}>保存到收件箱</button></section></dialog>;
}

function FocusSession({ close, navigate }: { close: () => void; navigate: (page: PageKey) => void }) {
  const [step, setStep] = useState(0);
  const stages = ["浏览", "学习", "沉淀", "选题", "结束"];
  return <div className="modal-backdrop focus-backdrop"><section className="focus-dialog"><button className="drawer-close" onClick={close}><X size={20} /></button><div className="focus-progress">{stages.map((stage, index) => <div className={index <= step ? "active" : ""} key={stage}><i /><span>{stage}</span></div>)}</div><div className="focus-content"><span>专注会话 · {step + 1} / 5</span><h2>{step === 0 ? "先浏览一个重要事件" : step === 1 ? "学习一条高价值视频" : step === 2 ? "留下一个可复用输出" : step === 3 ? "确认一个候选选题" : "今天到这里就够了"}</h2><p>{step === 0 ? "已把同一事件的重复报道合并，你只需要判断这一件事。" : step === 1 ? "推荐观看 08:12—16:40，预计 9 分钟。" : step === 2 ? "保存一张知识卡，或写下自己的判断。" : step === 3 ? "只确认最值得继续验证的方向，不要求立刻制作。" : "本次完成 4 项有效处理，没有未读红点和连续打卡压力。"}</p><div className="focus-card"><span>{stages[step]}</span><strong>{step === 0 ? "AI 产品竞争转向长任务可靠性" : step === 1 ? "如何设计可长期运行的研究系统" : step === 2 ? "来源有效性的最终标准" : step === 3 ? "AI 日报不是越多越好" : "会话完成"}</strong></div></div><footer><button className="secondary-button" onClick={close}>稍后继续</button><button className="primary-button" onClick={() => { if (step < 4) setStep(step + 1); else { close(); navigate("today"); } }}>{step < 4 ? "完成并继续" : "结束会话"}<ArrowRight size={16} /></button></footer></section></div>;
}

function ConnectorDialog({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const [type, setType] = useState("generic_api");
  const [tested, setTested] = useState(false);
  return <dialog open className="modal-backdrop"><button className="backdrop-dismiss" aria-label="关闭连接器配置" onClick={close} /><section className="connector-dialog"><button className="drawer-close" onClick={close}><X size={18} /></button><span className="dialog-kicker">可视化连接器</span><h2>添加来源</h2><div className="connector-types">{[["generic_api","JSON API"],["rss","RSS"],["webhook","Webhook"],["get_notes","Get 笔记"]].map(([value,label]) => <button className={type === value ? "active" : ""} onClick={() => setType(value)} key={value}>{label}</button>)}</div><div className="form-grid"><label><span>Base URL</span><input placeholder="https://api.example.com" /></label><label><span>路径</span><input placeholder="/v1/items" /></label><label><span>请求方法</span><select><option>GET</option><option>POST</option></select></label><label><span>分页方式</span><select><option>Cursor</option><option>Page</option><option>Offset</option></select></label><label className="full"><span>Header / Token（服务端加密保存）</span><input type="password" placeholder="不会显示在日志中" /></label></div><h3>字段映射</h3><div className="mapping-grid"><span>标准字段</span><span>原始字段路径</span>{[["标题","data.title"],["正文","data.content"],["发布时间","data.published_at"],["唯一 ID","data.id"]].flatMap(([a,b]) => [<strong key={`${a}-a`}>{a}</strong>,<input key={`${a}-b`} defaultValue={b} />])}</div><div className="connector-preview"><div><strong>原始响应预览</strong><pre>{tested ? '{ "data": { "id": "item_01", "title": "示例" } }' : "测试连接后显示"}</pre></div><ArrowRight size={18} /><div><strong>标准化预览</strong><pre>{tested ? '{ "externalId": "item_01", "title": "示例" }' : "等待字段映射"}</pre></div></div><footer><button className="secondary-button" onClick={() => setTested(true)}>测试连接</button><button className="primary-button" disabled={!tested} onClick={() => { notify("连接配置已验证；Demo 模式不保存凭证"); close(); }}>保存来源</button></footer></section></dialog>;
}

function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><p>{detail}</p></div>;
}
