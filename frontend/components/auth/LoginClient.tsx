"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronLeft,
  Chrome,
  CloudRain,
  CloudSun,
  Lock,
  Mail,
  Sun,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";
import { getConfiguredSiteUrl, PRODUCTION_SITE_URL } from "@/lib/site-url";
import { useI18n } from "@/hooks/useI18n";

type Mode = "login" | "signup";

type LoginClientProps = {
  nextPath: string;
  initialMode?: Mode;
};

export function LoginClient({ nextPath, initialMode }: LoginClientProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const [mode, setMode] = useState<Mode>(initialMode ?? "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [infoText, setInfoText] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const supabaseReady = hasSupabasePublicEnv();
  const isLogin = mode === "login";
  const siteOrigin =
    getConfiguredSiteUrl() ||
    (typeof window !== "undefined" ? window.location.origin : PRODUCTION_SITE_URL);
  const isEn = locale === "en-US";
  
  const copy = {
    backHome: isEn ? "Back to Home" : "返回首页",
    subtitle: isEn
      ? "Explore weather details from every corner of the world"
      : "探索世界每一个角落的气象细节",
    googleOneClick: isEn
      ? "Continue with Google"
      : "使用 Google 账号一键登录",
    orEmail: isEn ? "Or continue with email" : "或使用邮箱",
    login: isEn ? "Sign In" : "登录",
    signup: isEn ? "Sign Up" : "注册",
    passwordLoginPlaceholder: isEn ? "Enter password" : "输入密码",
    passwordSignupPlaceholder: isEn
      ? "Set at least 6 characters"
      : "设置至少 6 位密码",
    loginSubmit: isEn ? "Start your weather decision journey" : "开启气象决策之旅",
    loginSubmitting: isEn ? "Signing in..." : "正在登录...",
    signupSubmit: isEn ? "Create account now" : "立即创建账号",
    signupSubmitting: isEn ? "Creating account..." : "正在创建账号...",
    googleSubmitting: isEn ? "Connecting Google..." : "正在连接 Google...",
    loginHint: isEn
      ? "After signing in, your homepage will be personalized."
      : "登录后将为您个性化定制首页数据",
    signupHint: isEn
      ? "By signing up, you agree to our Terms of Service."
      : "注册即代表同意我们的服务条款",
    realtime: isEn ? "Realtime data" : "实时数据",
    highPrecision: isEn ? "High-precision forecast" : "高精度预测",
    supabaseMissing: isEn
      ? "Supabase is not configured. Sign-in is unavailable."
      : "Supabase 未配置，无法使用登录",
    needEmailPassword: isEn
      ? "Please enter email and password."
      : "请输入邮箱和密码",
    signupCheckEmail: isEn
      ? "Sign-up successful. Please verify your email before signing in."
      : "注册成功，请检查邮箱并完成验证后登录。",
    reset: isEn ? "Forgot password?" : "忘记密码？",
    resetSent: isEn
      ? "Reset link sent. Check your inbox."
      : "重置链接已发送，请检查收件箱。",
    resetPlaceholder: isEn ? "Enter your email to reset" : "输入邮箱以重置密码",
    resendVerify: isEn
      ? "Didn't receive the verification email? Sign up again with the same email to resend."
      : "没收到验证邮件？用同一邮箱重新注册即可重发。",
    loginFailedHint: isEn
      ? "If you just signed up, please verify your email first. Check your inbox or spam folder."
      : "如果刚注册，请先点击邮箱中的验证链接。检查收件箱或垃圾邮件。",
    
    // New translations for Koyfin-style layouts
    workEmail: isEn ? "Work email" : "工作邮箱",
    password: isEn ? "Password" : "密码",
    welcomeBack: isEn ? "Welcome Back" : "欢迎回来",
    signUpTitle: isEn ? "Sign up for your PolyWeather account" : "注册您的 PolyWeather 账户",
    newToPoly: isEn ? "New to PolyWeather?" : "还没有 PolyWeather 账号？",
    alreadyHave: isEn ? "Already have an account?" : "已经有账号了？",
    termsAgreement: isEn
      ? "By proceeding, you agree to the Privacy Policy and Terms & Conditions."
      : "继续操作即代表您同意隐私政策与服务条款。",
    desc: isEn
      ? "Access robust METAR observations, advanced DEB forecast blends, and real-time AI decision cards that bring clarity to your weather risk analyses."
      : "提供精准的机场 METAR 实况、先进的 DEB 智能融合预测和实时 AI 决策卡片，助您理清气象风险脉络。",
    trusted: isEn ? "Trusted by industry professionals" : "深受行业决策人员信赖",
  } as const;
  const submittingLabel = isLogin ? copy.loginSubmitting : copy.signupSubmitting;
  const googleSubmittingLabel = copy.googleSubmitting;
  const loadingSpinner = (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );

  const onResetPassword = async () => {
    setErrorText("");
    setInfoText("");
    if (!email.trim()) {
      setErrorText(copy.resetPlaceholder);
      return;
    }
    if (!supabaseReady) {
      setErrorText(copy.supabaseMissing);
      return;
    }
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${siteOrigin}/auth/callback?next=${encodeURIComponent(
          `/auth/reset-password?next=${encodeURIComponent(nextPath || "/account")}`,
        )}`,
      });
      if (error) {
        setErrorText(error.message);
        return;
      }
      setResetSent(true);
      setInfoText(copy.resetSent);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!supabaseReady) return;
    const run = async () => {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        router.replace(nextPath);
      }
    };
    void run();
  }, [nextPath, router, supabaseReady]);

  const onGoogleSignIn = async () => {
    setErrorText("");
    setInfoText("");
    if (!supabaseReady) {
      setErrorText(copy.supabaseMissing);
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo = `${siteOrigin}/auth/callback?next=${encodeURIComponent(
        nextPath,
      )}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });
      if (error) {
        setErrorText(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const onEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorText("");
    setInfoText("");
    if (!supabaseReady) {
      setErrorText(copy.supabaseMissing);
      return;
    }
    if (!email.trim() || !password.trim()) {
      setErrorText(copy.needEmailPassword);
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setErrorText(error.message);
          return;
        }
        router.replace(nextPath);
        return;
      }

      const emailRedirectTo = `${siteOrigin}/auth/callback?next=${encodeURIComponent(
        nextPath,
      )}`;
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo,
        },
      });
      if (error) {
        setErrorText(error.message);
        return;
      }
      if (data.session?.user) {
        router.replace(nextPath);
        return;
      }
      setInfoText(copy.signupCheckEmail);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-[#f8fafc] font-sans text-slate-900">
      {/* Left Column (Shared Dark Column with Illustrative Widget) */}
      <div className="relative hidden lg:flex lg:w-[460px] xl:w-[500px] 2xl:w-[560px] flex-col justify-between bg-gradient-to-br from-[#060913] via-[#0f1527] to-[#040815] p-10 text-white shrink-0 overflow-hidden border-r border-white/5">
        {/* Ambient Glows */}
        <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-blue-600/10 blur-[130px] pointer-events-none" />
        <div className="absolute -right-20 -bottom-20 h-[360px] w-[360px] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />
        <div className="absolute top-1/2 right-0 h-[240px] w-[240px] -translate-y-1/2 rounded-full bg-amber-500/5 blur-[100px] pointer-events-none" />
        
        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-14">
          <Link href="/" className="flex items-center hover:opacity-90 transition-opacity">
            <img src="/logo.png" alt="PolyWeather" className="h-8 w-auto object-contain brightness-0 invert" />
          </Link>

          <div className="space-y-6">
            <h2 className="text-3xl font-black leading-[1.25] tracking-tight text-white animate-fade-up [animation-delay:150ms] opacity-0">
              {isEn ? (
                <>
                  Weather intelligence and risk management{" "}
                  <span className="inline-block px-2.5 py-0.5 mt-1 rounded bg-gradient-to-r from-blue-600 to-indigo-500 text-white font-bold text-[0.9em] shadow-lg shadow-blue-600/25 animate-gradient bg-[length:200%_auto]">
                    simplified.
                  </span>
                </>
              ) : (
                <>
                  天气信息与风险管理{" "}
                  <span className="inline-block px-2.5 py-0.5 mt-1 rounded bg-gradient-to-r from-blue-600 to-indigo-500 text-white font-bold text-[0.9em] shadow-lg shadow-blue-600/25 animate-gradient bg-[length:200%_auto]">
                    化繁为简。
                  </span>
                </>
              )}
            </h2>
            <p className="text-sm leading-7 text-slate-400 max-w-md animate-fade-up [animation-delay:300ms] opacity-0">
              {copy.desc}
            </p>
          </div>
        </div>

        {/* High-Fidelity Mock Terminal Preview Widget */}
        <div className="relative z-10 my-auto p-[1px] bg-gradient-to-b from-white/15 to-transparent rounded-2xl shadow-2xl overflow-hidden hover:scale-[1.01] hover:shadow-blue-500/10 transition-all duration-500 max-w-[420px] w-full animate-fade-up [animation-delay:450ms] opacity-0">
          <div className="bg-[#0b0f19]/80 backdrop-blur-xl rounded-2xl p-6">
            {/* Terminal Top Window Controls */}
            <div className="flex items-center gap-1.5 mb-5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
              <span className="ml-2 font-mono text-[9px] text-slate-500 tracking-wider">POLYWEATHER_CONSOLE_v1.7</span>
            </div>

            <div className="flex items-center justify-between border-b border-white/5 pb-3.5 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-300">
                  {isEn ? "Runway 02L Consensus" : "跑道 02L 实测校验"}
                </span>
              </div>
              <span className="font-mono text-[9px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 tracking-wider">LIVE</span>
            </div>

            {/* Terminal metrics grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <span className="block text-[9px] uppercase tracking-wider text-slate-400 mb-0.5">{isEn ? "Current Temp" : "当前温度"}</span>
                <span className="font-mono text-base font-bold text-white tracking-tight">28.8°C</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <span className="block text-[9px] uppercase tracking-wider text-slate-400 mb-0.5">{isEn ? "Target Threshold" : "监控阈值"}</span>
                <span className="font-mono text-base font-bold text-rose-400 tracking-tight">30.0°C</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <span className="block text-[9px] uppercase tracking-wider text-slate-400 mb-0.5">{isEn ? "Model Blend" : "模型融合"}</span>
                <span className="font-mono text-base font-bold text-blue-400 tracking-tight">88.5%</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <span className="block text-[9px] uppercase tracking-wider text-slate-400 mb-0.5">{isEn ? "Observed Peak" : "今日最高"}</span>
                <span className="font-mono text-base font-bold text-emerald-400 tracking-tight">29.2°C</span>
              </div>
            </div>

            {/* SVG Interactive Line Chart Preview */}
            <div className="mb-2">
              <div className="flex items-center justify-between text-[9px] text-slate-400 mb-2 font-mono">
                <span>{isEn ? "TEMP TREND (24H)" : "气温趋势 (24小时)"}</span>
                <span className="text-blue-400 font-bold">Blend vs Obs</span>
              </div>
              <div className="relative h-28 w-full bg-slate-950/60 rounded-xl p-2 border border-white/5">
                <svg className="w-full h-full" viewBox="0 0 340 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Grid Lines */}
                  <line x1="0" y1="20" x2="340" y2="20" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  <line x1="0" y1="50" x2="340" y2="50" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  <line x1="0" y1="80" x2="340" y2="80" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  <line x1="85" y1="0" x2="85" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  <line x1="170" y1="0" x2="170" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  <line x1="255" y1="0" x2="255" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />

                  {/* Threshold Line (30.0°C) */}
                  <line x1="0" y1="40" x2="340" y2="40" stroke="#f43f5e" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
                  <text x="5" y="36" fill="#f43f5e" className="text-[8px] font-mono font-semibold">30.0°C Target</text>

                  {/* Gradient Area under Forecast */}
                  <path
                    d="M 0 85 Q 40 75 85 60 T 170 35 T 255 45 T 340 55 L 340 100 L 0 100 Z"
                    fill="url(#chartGradient)"
                    opacity="0.15"
                  />

                  {/* Forecast Line (Blue) */}
                  <path
                    d="M 0 85 Q 40 75 85 60 T 170 35 T 255 45 T 340 55"
                    stroke="#3b82f6"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />

                  {/* Observation Line (Green Solid, ending at current 170px) */}
                  <path
                    d="M 0 87 Q 40 78 85 63 T 170 33"
                    stroke="#10b981"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />

                  {/* Current Temp Point */}
                  <circle cx="170" cy="33" r="4" fill="#10b981" />
                  <circle cx="170" cy="33" r="8" stroke="#10b981" strokeWidth="1.5" className="animate-ping" opacity="0.5" />

                  {/* Definitions for Gradients */}
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-[10px] text-slate-500 font-mono">
          {isEn ? "PolyWeather institutional analytics suite" : "PolyWeather 机构版天气决策系统"}
        </div>
      </div>

      {/* Right Column (Forms) */}
      <div className="flex flex-1 flex-col justify-between p-6 sm:p-10 bg-gradient-to-br from-[#f8fafc] via-[#ffffff] to-[#eff4f9] min-h-screen relative overflow-hidden">
        {/* Subtle mesh background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.01)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.01)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none animate-pulse" style={{ animationDuration: '4s' }} />
        
        {/* Top Header Switch */}
        <div className="relative z-10 flex justify-between lg:justify-end items-center gap-3">
          {/* Logo on top-left for mobile only */}
          <Link href="/" className="flex items-center hover:opacity-90 transition-opacity lg:hidden">
            <img src="/logo.png" alt="PolyWeather" className="h-7 w-auto object-contain" />
          </Link>
          
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              {isLogin ? copy.newToPoly : copy.alreadyHave}
            </span>
            <button
              type="button"
              onClick={() => {
                setErrorText("");
                setInfoText("");
                setMode(isLogin ? "signup" : "login");
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98]"
            >
              {isLogin ? copy.signup : copy.login}
            </button>
          </div>
        </div>

        {/* Center Form Card */}
        <div className="relative z-10 flex flex-1 items-center justify-center my-10">
          <div className="w-full max-w-[440px] bg-white/90 backdrop-blur-xl border border-slate-200/50 rounded-2xl p-6 sm:p-10 shadow-[0_24px_60px_rgba(8,16,36,0.06)] animate-fade-up [animation-delay:200ms] opacity-0 transition-transform hover:-translate-y-1 hover:shadow-[0_32px_80px_rgba(8,16,36,0.08)] duration-500">
            <div className="mb-6">
              <h1 className="text-2xl font-black tracking-tight text-slate-900 mb-2">
                {isLogin ? copy.welcomeBack : copy.signUpTitle}
              </h1>
              <p className="text-xs text-slate-500 leading-relaxed">
                {copy.subtitle}
              </p>
            </div>

            <form onSubmit={(event) => void onEmailSubmit(event)} className="space-y-5">
              <div className="space-y-2 animate-fade-up [animation-delay:350ms] opacity-0">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  {copy.workEmail}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="yourname@email.com"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-200 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                  />
                </div>
              </div>

              <div className="space-y-2 animate-fade-up [animation-delay:450ms] opacity-0">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    {copy.password}
                  </label>
                  {isLogin && !resetSent ? (
                    <button
                      type="button"
                      onClick={() => void onResetPassword()}
                      disabled={loading}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      {copy.reset}
                    </button>
                  ) : null}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={isLogin ? copy.passwordLoginPlaceholder : copy.passwordSignupPlaceholder}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-11 text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-200 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {!isLogin && (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {copy.termsAgreement}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 hover:from-blue-600 hover:to-indigo-600 text-sm font-bold text-white shadow-lg shadow-slate-950/10 hover:shadow-blue-600/25 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 mt-8 flex items-center justify-center gap-2 group animate-fade-up [animation-delay:550ms] opacity-0"
              >
                {loading ? loadingSpinner : null}
                <span>{loading ? submittingLabel : (isLogin ? copy.loginSubmit : copy.signupSubmit)}</span>
                {!loading && <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />}
              </button>
            </form>

            <div className="my-6 flex items-center">
              <div className="h-px flex-grow bg-slate-200/60" />
              <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {isEn ? "or" : "或"}
              </span>
              <div className="h-px flex-grow bg-slate-200/60" />
            </div>

            <button
              type="button"
              onClick={() => void onGoogleSignIn()}
              disabled={loading}
              aria-busy={loading}
              className="w-full py-3 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.99] transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? loadingSpinner : <Chrome className="h-4 w-4 text-blue-600" />}
              <span>{loading ? googleSubmittingLabel : copy.googleOneClick}</span>
            </button>

            {errorText ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700 leading-normal">{errorText}</p> : null}
            {infoText ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 leading-normal">{infoText}</p> : null}
            {errorText && isLogin && errorText.includes("Invalid login") ? (
              <p className="mt-2 text-center text-xs text-slate-500 leading-relaxed">{copy.loginFailedHint}</p>
            ) : null}
            {infoText === copy.signupCheckEmail ? (
              <p className="mt-2 text-center text-xs text-slate-500 leading-relaxed">{copy.resendVerify}</p>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-[10px] text-slate-400 text-center font-mono">
          © {new Date().getFullYear()} PolyWeather. All rights reserved.
        </div>
      </div>
    </div>
  );
}
