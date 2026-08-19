"use client";
import{useEffect,useState}from"react";
import{Sparkles}from"lucide-react";
import type{ProcessingMode}from"../../lib/domain/signal-desk";
import{apiFetch}from"../../lib/client/api";

type RequestStatus="queued"|"fetching_transcript"|"translating_transcript"|"analyzing"|"ready"|"limited_ready"|"failed";
const labels:Record<RequestStatus|ProcessingMode,string>={metadata_only:"深度处理",deep_requested:"深度处理",queued:"已排队",fetching_transcript:"正在获取字幕",translating_transcript:"正在翻译字幕",analyzing:"正在分析",ready:"处理完成",limited_ready:"处理受限",failed:"重新处理"};
const active=new Set<RequestStatus>(["queued","fetching_transcript","translating_transcript","analyzing"]);

export function DeepProcessButton({contentId,initialMode,onComplete}:{contentId:string;initialMode:ProcessingMode;onComplete?:()=>void}){const[status,setStatus]=useState<RequestStatus|ProcessingMode>(initialMode);const[error,setError]=useState<string|null>(null);const busy=active.has(status as RequestStatus);useEffect(()=>{if(!busy)return;let cancelled=false;const poll=async()=>{try{const result=await apiFetch<{request:{status:RequestStatus}|null}>(`/api/content/${contentId}/process`);if(cancelled||!result.request)return;setStatus(result.request.status);if(["ready","limited_ready"].includes(result.request.status))onComplete?.();}catch{/* The next poll can recover a transient read failure. */}};void poll();const timer=window.setInterval(()=>void poll(),3_000);return()=>{cancelled=true;window.clearInterval(timer)}},[busy,contentId,onComplete]);async function start(){setError(null);setStatus("queued");try{const result=await apiFetch<{status:RequestStatus}>(`/api/content/${contentId}/process`,{method:"POST",body:JSON.stringify({mode:"deep"})});setStatus(result.status);}catch(reason){setStatus("failed");setError(reason instanceof Error?reason.message:"创建处理任务失败");}}return<span className="v2-deep-process"><button type="button"disabled={busy||status==="ready"}onClick={()=>void start()}><Sparkles size={14}/>{labels[status]??"深度处理"}</button>{error&&<small>{error}</small>}</span>}
