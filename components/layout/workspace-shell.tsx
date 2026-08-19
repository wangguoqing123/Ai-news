"use client";

import { BookOpen,ChevronDown,Compass,Lightbulb,Menu,Newspaper,Radio,Search,Settings,Wifi,X } from "lucide-react";
import Link from "../ui/app-link";
import { usePathname } from "next/navigation";
import { useEffect,useState } from "react";
import { getBrowserSupabase } from "../../lib/supabase/client";
import { LoginScreen } from "../../app/login-screen";
import { apiFetch } from "../../lib/client/api";

const nav = [
  { href:"/today",label:"今日",icon:Compass },{ href:"/ai-news",label:"AI 动态",icon:Newspaper },
  { href:"/creators",label:"博主动态",icon:Radio },{ href:"/learning",label:"学习与选题",icon:BookOpen },{ href:"/sources",label:"来源",icon:Wifi },
];

export function WorkspaceShell({ children }:{ children:React.ReactNode }) {
  const pathname = usePathname();
  const [auth,setAuth] = useState<"loading"|"ready"|"login">("loading");
  const [isDemo,setIsDemo]=useState(false);
  const [mobileOpen,setMobileOpen] = useState(false);
  const [searchOpen,setSearchOpen]=useState(false);const[query,setQuery]=useState("");const[results,setResults]=useState<Array<{id:string;type:string;title:string;excerpt:string|null;href:string}>>([]);
  useEffect(() => {
    const supabase = getBrowserSupabase();
    let active=true;let unsubscribe:(()=>void)|undefined;
    fetch("/api/health").then((response)=>response.json() as Promise<{mode?:string}>).then((health)=>{
      if(!active)return;
      if(health.mode==="demo"){setIsDemo(true);setAuth("ready");return;}
      if(!supabase){setAuth("login");return;}
      void supabase.auth.getSession().then(({data})=>{if(active)setAuth(data.session?"ready":"login")});
      const listener=supabase.auth.onAuthStateChange((_event,session)=>{if(active)setAuth(session?"ready":"login")});unsubscribe=()=>listener.data.subscription.unsubscribe();
    }).catch(()=>{if(active)setAuth("login")});
    return () => {active=false;unsubscribe?.()};
  },[]);
  useEffect(()=>{if(!searchOpen||!query.trim()){setResults([]);return}const timer=window.setTimeout(()=>void apiFetch<{items:typeof results}>(`/api/search?q=${encodeURIComponent(query)}`).then((data)=>setResults(data.items)).catch(()=>setResults([])),250);return()=>window.clearTimeout(timer)},[query,searchOpen]);
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setSearchOpen(true)}if(event.key==="Escape")setSearchOpen(false)};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler)},[]);
  if (auth === "loading") return <main className="v2-auth-loading"><span className="v2-brand-mark" />正在打开真实工作区…</main>;
  if (auth === "login") return <LoginScreen />;
  return <main className="v2-shell">
    <aside className={mobileOpen ? "v2-sidebar open" : "v2-sidebar"}>
      <Link className="v2-brand" href="/today" onClick={() => setMobileOpen(false)}><span className="v2-brand-mark" /><span><strong>Signal Desk</strong><small>信号台</small></span></Link>
      <nav aria-label="主导航">{nav.map((item) => <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""} onClick={() => setMobileOpen(false)}><item.icon size={19} /><span>{item.label}</span></Link>)}</nav>
      <div className="v2-sidebar-bottom">
        <Link href="/settings" className={pathname.startsWith("/settings") ? "active" : ""}><Settings size={19} /><span>设置</span></Link>
        <button><span className="v2-user-avatar">W</span><span><strong>我的工作区</strong><small>个人情报工作台</small></span><ChevronDown size={16} /></button>
      </div>
    </aside>
    <section className="v2-workspace">
      <header className="v2-topbar"><button className="v2-mobile-menu" onClick={() => setMobileOpen((value) => !value)} aria-label="打开导航"><Menu size={21} /></button>{isDemo&&<span className="v2-demo-badge">演示模式 · 不含真实数据</span>}<button className="v2-search"onClick={()=>setSearchOpen(true)}><Search size={17} /><span>搜索事件、博主内容与选题</span><kbd>⌘ K</kbd></button><Link href="/learning" className="v2-quiet-action"><Lightbulb size={16} />查看选题</Link></header>
      {children}
    </section>
    {searchOpen&&<dialog open aria-modal="true"aria-label="搜索工作区"className="v2-modal-backdrop"><section className="v2-search-modal"><header><Search size={19}/><input value={query}onChange={event=>setQuery(event.target.value)}placeholder="搜索真实内容、笔记、知识卡与选题"/><button onClick={()=>setSearchOpen(false)}><X size={18}/></button></header><div>{results.map(item=><Link key={`${item.type}-${item.id}`}href={item.href}onClick={()=>setSearchOpen(false)}><small>{item.type}</small><strong>{item.title}</strong><p>{item.excerpt}</p></Link>)}{query.trim()&&!results.length&&<p className="empty">没有匹配的真实记录</p>}</div></section></dialog>}
  </main>;
}
