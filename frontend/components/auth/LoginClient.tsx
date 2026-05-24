"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronLeft,
  Chrome,
  Cloud,
  CloudRain,
  Lock,
  Mail,
  Sun,
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
};

export function LoginClient({ nextPath }: LoginClientProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [infoText, setInfoText] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const supabaseReady = hasSupabasePublicEnv();
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
    loginSubmit: isEn ? "Start your weather journey" : "开启天气之旅",
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

  const isLogin = mode === "login";

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#f4f7fb] px-4 py-8 font-sans text-slate-900">
      <div className="absolute inset-x-0 top-0 h-24 border-b border-slate-200 bg-white" />

      <div className="relative w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
        <Link
          href="/"
          className="group absolute left-6 top-6 rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-500 transition-all hover:border-slate-300 hover:bg-white hover:text-slate-900 active:scale-95"
          title={copy.backHome}
          aria-label={copy.backHome}
        >
          <ChevronLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
        </Link>
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl border border-blue-200 bg-blue-600 shadow-sm">
            <Cloud className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">PolyWeather</h1>
          <p className="mt-2 text-center text-sm text-slate-500">{copy.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => void onGoogleSignIn()}
          disabled={loading}
          className="mb-6 flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-3.5 font-semibold text-slate-900 shadow-sm transition-all duration-200 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
        >
          <Chrome className="mr-3 h-5 w-5" />
          {copy.googleOneClick}
        </button>

        <div className="my-6 flex items-center">
          <div className="h-px flex-grow bg-slate-200" />
          <span className="px-4 text-xs font-semibold uppercase text-slate-500">
            {copy.orEmail}
          </span>
          <div className="h-px flex-grow bg-slate-200" />
        </div>

        <div className="mb-6 flex rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              isLogin
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {copy.login}
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              !isLogin
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {copy.signup}
          </button>
        </div>

        <form onSubmit={(event) => void onEmailSubmit(event)} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-300 bg-white py-3.5 pl-12 pr-4 text-slate-950 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                isLogin
                  ? copy.passwordLoginPlaceholder
                  : copy.passwordSignupPlaceholder
              }
              className="w-full rounded-lg border border-slate-300 bg-white py-3.5 pl-12 pr-4 text-slate-950 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {isLogin && !resetSent ? (
            <div className="mt-2 text-right">
              <button
                type="button"
                onClick={() => void onResetPassword()}
                disabled={loading}
                className="text-xs text-slate-500 underline-offset-2 transition-all hover:text-blue-600 hover:underline disabled:opacity-50"
              >
                {copy.reset}
              </button>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="group mt-8 flex w-full items-center justify-center rounded-lg border border-blue-700 bg-blue-600 py-3.5 font-bold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLogin ? copy.loginSubmit : copy.signupSubmit}
            <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>
        </form>

        {errorText ? <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorText}</p> : null}
        {infoText ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{infoText}</p> : null}
        {errorText && isLogin && errorText.includes("Invalid login") ? (
          <p className="mt-1 text-xs text-slate-500">{copy.loginFailedHint}</p>
        ) : null}
        {infoText === copy.signupCheckEmail ? (
          <p className="mt-1 text-xs text-slate-500">{copy.resendVerify}</p>
        ) : null}

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-500">
            {isLogin ? copy.loginHint : copy.signupHint}
          </p>
        </div>

        {!supabaseReady ? (
          <p className="mt-3 text-center text-sm text-rose-300">{copy.supabaseMissing}</p>
        ) : null}
      </div>

      <div className="relative mt-6 flex items-center gap-4 text-sm font-medium text-slate-500">
        <span className="flex items-center">
          <Sun className="mr-1 h-4 w-4" /> {copy.realtime}
        </span>
        <span className="flex items-center">
          <CloudRain className="mr-1 h-4 w-4" /> {copy.highPrecision}
        </span>
      </div>
    </div>
  );
}
