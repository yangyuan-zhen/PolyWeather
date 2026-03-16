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

  const supabaseReady = hasSupabasePublicEnv();
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
  } as const;

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
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
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

      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
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
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#0f172a] font-sans">
      <div className="absolute left-[-10%] top-[-10%] h-[40vw] w-[40vw] animate-pulse rounded-full bg-blue-600/20 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[30vw] w-[30vw] rounded-full bg-indigo-500/20 blur-[100px]" />

      <div className="relative mx-4 w-full max-w-[420px] rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
        <Link
          href="/"
          className="group absolute left-6 top-6 rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition-all hover:bg-white/10 hover:text-white active:scale-90"
          title={copy.backHome}
          aria-label={copy.backHome}
        >
          <ChevronLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
        </Link>
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-400 shadow-lg shadow-blue-500/20">
            <Cloud className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">PolyWeather</h1>
          <p className="mt-2 text-sm text-slate-400">{copy.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => void onGoogleSignIn()}
          disabled={loading}
          className="mb-6 flex w-full items-center justify-center rounded-xl bg-white px-4 py-3.5 font-semibold text-slate-900 shadow-lg transition-all duration-200 hover:bg-slate-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
        >
          <Chrome className="mr-3 h-5 w-5" />
          {copy.googleOneClick}
        </button>

        <div className="my-6 flex items-center">
          <div className="h-[1px] flex-grow bg-white/10" />
          <span className="px-4 text-xs font-medium uppercase tracking-widest text-slate-500">
            {copy.orEmail}
          </span>
          <div className="h-[1px] flex-grow bg-white/10" />
        </div>

        <div className="mb-6 flex rounded-xl bg-black/20 p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              isLogin
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {copy.login}
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              !isLogin
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-slate-200"
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
              className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-white placeholder:text-slate-600 transition-all focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
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
              className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-white placeholder:text-slate-600 transition-all focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group mt-8 flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3.5 font-bold text-white shadow-xl shadow-blue-600/20 transition-all hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLogin ? copy.loginSubmit : copy.signupSubmit}
            <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>
        </form>

        {errorText ? <p className="mt-4 text-sm text-rose-300">{errorText}</p> : null}
        {infoText ? <p className="mt-4 text-sm text-emerald-300">{infoText}</p> : null}

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-500">
            {isLogin ? copy.loginHint : copy.signupHint}
          </p>
        </div>

        {!supabaseReady ? (
          <p className="mt-3 text-center text-sm text-rose-300">{copy.supabaseMissing}</p>
        ) : null}
      </div>

      <div className="absolute bottom-8 flex items-center gap-4 text-sm text-slate-600">
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
