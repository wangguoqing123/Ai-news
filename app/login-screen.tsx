"use client";

import { ArrowRight, Check, KeyRound, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { getBrowserSupabase } from "../lib/supabase/client";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const sendCode = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase || !email) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    setLoading(false);
    if (error) setMessage(error.message);
    else { setSent(true); setMessage("验证码已发送，请检查邮箱。"); }
  };

  const verifyCode = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase || !email || !code) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setLoading(false);
    if (error) setMessage(error.message);
    else window.location.reload();
  };

  return <main className="login-page"><section className="login-brand"><div className="brand-mark"><span /></div><div><strong>Signal Desk</strong><small>信号台</small></div><h1>把分散信号，变成你自己的理解与选题。</h1><p>一个安静、克制、以证据为中心的个人内容工作台。</p><div className="login-points"><span><Check size={16} />同一事件自动去重与聚类</span><span><Check size={16} />视频学习留下知识和实践</span><span><Check size={16} />选题关联每一条来源证据</span></div></section><section className="login-form"><div><span className="dialog-kicker">个人工作区</span><h2>登录 Signal Desk</h2><p>使用邮箱验证码登录，不需要设置密码。</p><label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>{sent && <label><span>6 位验证码</span><input inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} placeholder="000000" /></label>}<button className="primary-button" disabled={loading || !email || (sent && !code)} onClick={sent ? verifyCode : sendCode}>{loading ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}{sent ? "验证并登录" : "发送验证码"}<ArrowRight size={16} /></button>{message && <div className="login-message">{message}</div>}<small>登录即创建你的默认个人工作区；数据由 Supabase RLS 隔离。</small></div></section></main>;
}
