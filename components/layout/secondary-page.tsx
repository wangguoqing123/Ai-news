"use client";
import{ArrowRight,RefreshCw}from"lucide-react";
import Link from"../ui/app-link";
import{useCallback,useEffect,useState}from"react";
import{apiFetch}from"../../lib/client/api";

const configs={inbox:{title:"收件箱",description:"全部原始内容与处理状态",endpoint:"/api/inbox"},knowledge:{title:"知识库",description:"笔记、知识卡与实践产物",endpoint:"/api/knowledge"},review:{title:"每周复盘",description:"最近 7 天的真实学习与产出",endpoint:"/api/review"},jobs:{title:"Job 管理",description:"同步、分析和生成任务的运行记录",endpoint:"/api/jobs"}}as const;
const reviewLabels:Record<string,string>={content:"新内容",learning:"完成学习",notes:"新增笔记",topics:"创建选题",practice:"完成实践"};

export function SecondaryPage({kind}:{kind:keyof typeof configs}){
  const[data,setData]=useState<Record<string,unknown>|null>(null);
  const[error,setError]=useState<string|null>(null);
  const config=configs[kind];
  const load=useCallback(async()=>{try{const query=kind==="jobs"&&typeof window!=="undefined"?window.location.search:"";setData(await apiFetch<Record<string,unknown>>(`${config.endpoint}${query}`));setError(null)}catch(reason){setError(reason instanceof Error?reason.message:"读取失败")}},[config.endpoint,kind]);
  useEffect(()=>{void load()},[load]);
  const rows=kind==="inbox"?(data?.items as Array<Record<string,unknown>>??[]):kind==="knowledge"?[...(data?.cards as Array<Record<string,unknown>>??[]),...(data?.notes as Array<Record<string,unknown>>??[]),...(data?.tasks as Array<Record<string,unknown>>??[])]:kind==="jobs"?(data?.items as Array<Record<string,unknown>>??[]):[];
  const summary=(data?.summary??{})as Record<string,number>;
  const requeueBlocked=async()=>{try{const result=await apiFetch<{requested:number}>("/api/analysis/requeue",{method:"POST",body:JSON.stringify({allBlocked:true})});await load();if(!result.requested)setError("当前没有 blocked 任务");}catch(reason){setError(reason instanceof Error?reason.message:"重新排队失败")}};
  const requeueStatus=async(status:"failed"|"dead_letter")=>{try{const result=await apiFetch<{requeued:number;skipped:number}>("/api/jobs/requeue",{method:"POST",body:JSON.stringify({status})});await load();if(!result.requeued)setError(`当前没有 ${status} 任务`);}catch(reason){setError(reason instanceof Error?reason.message:"重新排队失败")}};
  return <div className="v2-page">
    <header className="v2-page-header"><div><div className="v2-date">二级入口</div><h1>{config.title}</h1><p>{config.description}</p></div><div className="v2-header-actions">{kind==="jobs"&&<><button onClick={()=>void requeueBlocked()}>恢复 blocked</button><button onClick={()=>void requeueStatus("failed")}>重排 failed</button><button onClick={()=>void requeueStatus("dead_letter")}>重建 dead letter</button></>}<button className="v2-refresh-button"onClick={()=>void load()}><RefreshCw size={15}/>刷新</button></div></header>
    {error&&<div className="v2-error">{error}</div>}
    {kind==="review"&&<div className="v2-review-grid">{Object.entries(summary).map(([key,value])=><div key={key}><strong>{value}</strong><span>{reviewLabels[key]??key}</span></div>)}</div>}
    {rows.length?<div className="v2-secondary-list">{rows.map((row,index)=><article key={String(row.id??index)}><small>{String(row.type??row.note_type??row.status??"记录")}</small><h2>{String(row.title??row.name??row.markdown??row.type??"未命名记录")}</h2><p>{String(row.summary??row.content??row.purpose??row.blocked_reason??row.error??"")}</p>{kind==="jobs"&&Boolean(row.dependency_type)&&<p>依赖：{String(row.dependency_type)} · 下次检查 {String(row.next_retry_at??"待手动恢复")}</p>}{Boolean(row.id)&&kind==="inbox"&&<Link href={`/learning/${String(row.id)}`}>查看内容<ArrowRight size={14}/></Link>}</article>)}</div>:kind!=="review"&&<div className="v2-inline-empty"><strong>暂无记录</strong><p>这里不会显示 Demo 数据。</p></div>}
  </div>;
}
