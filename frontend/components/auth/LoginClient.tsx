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
    loginSubmit: isEn ? "Start your weather journey" : "开启天气交易之旅",
    signupSubmit: isEn ? "Create account now" : "立即创建账号",
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
      ? "Access robust METAR observations, advanced DEB forecast blends, and real-time AI decision cards that bring clarity to your weather-market portfolios."
      : "提供精准的机场 METAR 实况、先进的 DEB 智能融合预测和实时 AI 决策卡片，助您看清天气市场脉络。",
    trusted: isEn ? "Trusted by institutional traders" : "深受机构交易员信赖",
  } as const;

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
          "/account",
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

  if (mode === "signup") {
    return (
      <div className="flex min-h-screen w-full flex-col lg:flex-row bg-[#f8fafc] font-sans text-slate-900">
        {/* Left Dark Column */}
        <div className="relative flex flex-col justify-between bg-[#11161d] p-8 text-white lg:w-[480px] xl:w-[540px] shrink-0">
          <div className="flex flex-col gap-12">
            <Link href="/" className="flex items-center hover:opacity-90">
              <img src="/logo.png" alt="PolyWeather" className="h-8 w-auto object-contain" />
            </Link>

            <div className="mt-8 space-y-6">
              <h2 className="text-3xl font-black leading-[1.2] tracking-tight">
                {isEn ? (
                  <>
                    Weather intelligence and risk management{" "}
                    <span className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-[0.95em]">
                      simplified.
                    </span>
                  </>
                ) : (
                  <>
                    天气信息与风险管理{" "}
                    <span className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-[0.95em]">
                      化繁为简。
                    </span>
                  </>
                )}
              </h2>
              <p className="text-sm leading-7 text-slate-400 max-w-md">
                {copy.desc}
              </p>
            </div>
          </div>

          <div className="mt-12 space-y-8">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {copy.trusted}
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-sm">
                {[
                  "Atmos Capital",
                  "Celerity Risk",
                  "Metis Trading",
                  "Aviation Hedge",
                ].map((name) => (
                  <div
                    key={name}
                    className="flex h-9 items-center justify-center rounded border border-white/10 bg-white/5 text-xs font-medium text-slate-400"
                  >
                    {name}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-yellow-500">⭐⭐⭐⭐⭐</span>
              <span>4.9 out of 5 stars (G2 rating)</span>
            </div>
          </div>
        </div>

        {/* Right White Column (Signup Form) */}
        <div className="flex flex-1 flex-col items-center justify-center p-8 bg-white">
          <div className="w-full max-w-[400px]">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 mb-2">
              {copy.signUpTitle}
            </h1>
            <p className="text-xs text-slate-500 mb-6">
              {copy.subtitle}
            </p>

            <form onSubmit={(event) => void onEmailSubmit(event)} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  {copy.workEmail}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="yourname@email.com"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-950 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  {copy.password}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={copy.passwordSignupPlaceholder}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-950 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <p className="text-[11px] leading-5 text-slate-500 mt-2">
                {copy.termsAgreement}
              </p>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center rounded-lg bg-blue-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                {copy.signupSubmit}
              </button>
            </form>

            <div className="my-5 flex items-center">
              <div className="h-px flex-grow bg-slate-200" />
              <span className="px-3 text-[10px] font-semibold uppercase text-slate-400">
                {isEn ? "or" : "或"}
              </span>
              <div className="h-px flex-grow bg-slate-200" />
            </div>

            <button
              type="button"
              onClick={() => void onGoogleSignIn()}
              disabled={loading}
              className="flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Chrome className="mr-2 h-4 w-4 text-blue-600" />
              {copy.googleOneClick}
            </button>

            {errorText ? <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorText}</p> : null}
            {infoText ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{infoText}</p> : null}

            <p className="mt-6 text-center text-xs text-slate-500">
              {copy.alreadyHave}{" "}
              <button
                type="button"
                onClick={() => setMode("login")}
                className="font-bold text-blue-600 hover:underline"
              >
                {copy.login}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#f8fafc] font-sans text-slate-900">
      {/* Top Header */}
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
        <Link href="/" className="flex items-center hover:opacity-90">
          <img src="/logo.png" alt="PolyWeather" className="h-8 w-auto object-contain" />
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 hidden sm:inline">{copy.newToPoly}</span>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950"
          >
            {copy.signup}
          </button>
        </div>
      </header>

      {/* Main Login Card Area */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[400px] rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
          <h1 className="text-2xl font-black tracking-tight text-slate-900 mb-2">
            {copy.welcomeBack}
          </h1>
          <p className="text-xs text-slate-500 mb-6">
            {copy.subtitle}
          </p>

          <form onSubmit={(event) => void onEmailSubmit(event)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                {copy.workEmail}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="yourname@email.com"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-950 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  {copy.password}
                </label>
                {isLogin && !resetSent ? (
                  <button
                    type="button"
                    onClick={() => void onResetPassword()}
                    disabled={loading}
                    className="text-xs text-slate-500 hover:text-blue-600 transition-colors"
                  >
                    {copy.reset}
                  </button>
                ) : null}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={copy.passwordLoginPlaceholder}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-950 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-lg bg-[#11161d] py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#1f2937] disabled:opacity-50 mt-6"
            >
              {copy.loginSubmit}
            </button>
          </form>

          <div className="my-5 flex items-center">
            <div className="h-px flex-grow bg-slate-200" />
            <span className="px-3 text-[10px] font-semibold uppercase text-slate-400">
              {isEn ? "or" : "或"}
            </span>
            <div className="h-px flex-grow bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={() => void onGoogleSignIn()}
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Chrome className="mr-2 h-4 w-4 text-blue-600" />
            {copy.googleOneClick}
          </button>

          {errorText ? <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorText}</p> : null}
          {infoText ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{infoText}</p> : null}
          {errorText && isLogin && errorText.includes("Invalid login") ? (
            <p className="mt-2 text-center text-xs text-slate-500">{copy.loginFailedHint}</p>
          ) : null}
          {infoText === copy.signupCheckEmail ? (
            <p className="mt-2 text-center text-xs text-slate-500">{copy.resendVerify}</p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
