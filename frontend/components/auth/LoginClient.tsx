"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronLeft,
  Chrome,
  Lock,
  Mail,
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
  initialError?: string;
  initialMode?: Mode;
};

export function LoginClient({ nextPath, initialError, initialMode }: LoginClientProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const [mode, setMode] = useState<Mode>(initialMode ?? "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState(initialError || "");
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
    loginSubtitle: isEn
      ? "Sign in to continue to your weather decision terminal."
      : "登录后进入你的天气决策终端。",
    signupSubtitle: isEn
      ? "Create an account and get a one-time 3-day trial. No payment required first."
      : "创建账号后自动开启一次 3 天试用，无需先付款。",
    googleOneClick: isEn
      ? "Continue with Google"
      : "使用 Google 账号一键登录",
    orGoogle: isEn ? "Or continue with Google" : "或使用 Google",
    login: isEn ? "Sign In" : "登录",
    signup: isEn ? "Sign Up" : "注册",
    passwordLoginPlaceholder: isEn ? "Enter password" : "输入密码",
    passwordSignupPlaceholder: isEn
      ? "Set at least 6 characters"
      : "设置至少 6 位密码",
    loginSubmit: isEn ? "Enter PolyWeather Terminal" : "进入 PolyWeather 终端",
    loginSubmitting: isEn ? "Signing in..." : "正在登录...",
    signupSubmit: isEn ? "Create account and start trial" : "创建账号并领取试用",
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
    workEmail: isEn ? "Work email" : "工作邮箱",
    password: isEn ? "Password" : "密码",
    welcomeBack: isEn ? "Sign in to PolyWeather" : "登录 PolyWeather",
    signUpTitle: isEn ? "Create your PolyWeather account" : "创建 PolyWeather 账号",
    newToPoly: isEn ? "New to PolyWeather?" : "还没有 PolyWeather 账号？",
    alreadyHave: isEn ? "Already have an account?" : "已经有账号了？",
    termsAgreement: isEn
      ? "By proceeding, you agree to the Privacy Policy and Terms & Conditions."
      : "继续操作即代表您同意隐私政策与服务条款。",
    desc: isEn
      ? "Use the same terminal palette as the product: live temperature evidence, DEB paths, and settlement-source context in one calm workspace."
      : "沿用终端界面的配色和信息密度：实时温度证据、DEB 路径和结算源背景放在一个安静工作台里。",
    trusted: isEn ? "Trusted by industry professionals" : "深受行业决策人员信赖",
  } as const;
  const submittingLabel = isLogin ? copy.loginSubmitting : copy.signupSubmitting;
  const googleSubmittingLabel = copy.googleSubmitting;
  const formSubtitle = isLogin ? copy.loginSubtitle : copy.signupSubtitle;
  const accessHighlights = isEn
    ? ["Live temperature charts", "DEB forecast path", "Runway and settlement alerts"]
    : ["实时温度图表", "DEB 预测路径", "跑道与结算提醒"];
  const sideStats = isEn
    ? [
        { label: "Trial", value: "3 days" },
        { label: "Access", value: "Terminal" },
        { label: "Signals", value: "Runway" },
      ]
    : [
        { label: "试用", value: "3 天" },
        { label: "入口", value: "终端" },
        { label: "提醒", value: "跑道" },
      ];
  const loadingSpinner = (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );

  useEffect(() => {
    setErrorText(initialError || "");
  }, [initialError]);

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
    <div className="flex min-h-screen w-full bg-[#e9edf3] font-sans text-slate-950">
      <aside className="hidden w-[56px] shrink-0 flex-col items-center justify-between bg-[#171d24] py-5 text-white lg:flex">
        <Link
          href="/"
          aria-label="PolyWeather"
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/8 text-[11px] font-black text-sky-200"
        >
          PW
        </Link>
        <div className="flex flex-col items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-[#00897b]" />
          <span className="h-2 w-2 rounded-full bg-[#2563eb]" />
          <span className="h-2 w-2 rounded-full bg-slate-500" />
        </div>
        <Link
          href="/"
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/8 hover:text-white"
          aria-label={copy.backHome}
        >
          <ChevronLeft size={18} />
        </Link>
      </aside>

      <section className="relative hidden min-h-screen w-[44vw] max-w-[620px] shrink-0 overflow-hidden border-r border-[#d8e0ec] bg-[#171d24] p-6 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:34px_34px]" />
        <div className="relative z-10 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-base font-black tracking-tight text-white transition hover:text-sky-100"
          >
            <span>PolyWeather</span>
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Terminal
          </span>
        </div>

        <div className="relative z-10 mt-12 max-w-md">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-200">
            {isEn ? "Access Gate" : "终端入口"}
          </p>
          <h2 className="mt-4 text-3xl font-black leading-tight tracking-tight text-white">
            {isEn
              ? "Sign in where the terminal starts."
              : "从这里进入天气决策终端。"}
          </h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            {copy.desc}
          </p>
        </div>

        <div className="relative z-10 mt-10 overflow-hidden rounded-xl border border-white/10 bg-[#0b1220] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
          <div className="flex h-11 items-center gap-2 border-b border-white/10 bg-[#111827] px-4">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
            <span className="ml-2 font-mono text-[10px] text-slate-400">
              polyweather.top/terminal
            </span>
          </div>
          <img
            src="/static/web.webp"
            width="680"
            height="340"
            alt={isEn ? "PolyWeather terminal preview" : "PolyWeather 终端预览"}
            className="aspect-[16/9] w-full object-cover object-top"
            decoding="async"
          />
        </div>

        <div className="relative z-10 mt-5 grid grid-cols-3 gap-2">
          {sideStats.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-3"
            >
              <div className="font-mono text-sm font-black text-white">{item.value}</div>
              <div className="mt-1 text-[10px] font-bold text-slate-400">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="relative z-10 mt-auto flex items-center justify-between border-t border-white/10 pt-5 text-[11px] text-slate-400">
          <span>{isEn ? "Live charts" : "实时图表"}</span>
          <span>{isEn ? "DEB path" : "DEB 路径"}</span>
          <span>{isEn ? "Runway alerts" : "跑道提醒"}</span>
        </div>
      </section>

      <div className="relative flex min-h-screen flex-1 flex-col justify-between overflow-hidden bg-[#e9edf3] p-4 sm:p-6 lg:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.035)_1px,transparent_1px)] bg-[size:32px_32px]" />

        <div className="relative z-10 flex items-center justify-between gap-3 lg:justify-end">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-black tracking-tight text-slate-950 transition-opacity hover:opacity-80 lg:hidden"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 bg-white text-[10px] font-black text-blue-700 shadow-sm">
              PW
            </span>
            <span className="hidden min-[360px]:inline">PolyWeather</span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {isLogin ? copy.newToPoly : copy.alreadyHave}
            </span>
            <button
              type="button"
              onClick={() => {
                setErrorText("");
                setInfoText("");
                setMode(isLogin ? "signup" : "login");
              }}
              className="whitespace-nowrap rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-blue-700 active:scale-[0.98]"
            >
              {isLogin ? copy.signup : copy.login}
            </button>
          </div>
        </div>

        <div className="relative z-10 flex flex-1 items-start justify-center pt-10 sm:pt-12 lg:my-10 lg:items-center lg:pt-0">
          <div className="w-full max-w-[440px] rounded-xl border border-[#d8e0ec] bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-8">
            <div className="mb-6">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                {isLogin ? copy.loginSubmit : isEn ? "3-day trial" : "3 天试用"}
              </div>
              <h1 className="mb-2 text-2xl font-black tracking-tight text-slate-950">
                {isLogin ? copy.welcomeBack : copy.signUpTitle}
              </h1>
              <p className="text-sm leading-6 text-slate-600">
                {formSubtitle}
              </p>
            </div>

            <div className="mb-6 grid gap-2">
              {accessHighlights.map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                  {item}
                </div>
              ))}
            </div>

            <form onSubmit={(event) => void onEmailSubmit(event)} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
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
                    className="w-full rounded-lg border border-slate-300 bg-[#f8fafc] py-3 pl-11 pr-4 text-sm text-slate-950 placeholder:text-slate-400 transition focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                    {copy.password}
                  </label>
                  {isLogin && !resetSent ? (
                    <button
                      type="button"
                      onClick={() => void onResetPassword()}
                      disabled={loading}
                      className="text-xs font-bold text-blue-600 transition hover:text-blue-700"
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
                    className="w-full rounded-lg border border-slate-300 bg-[#f8fafc] py-3 pl-11 pr-11 text-sm text-slate-950 placeholder:text-slate-400 transition focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {!isLogin ? (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  {copy.termsAgreement}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="group mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3.5 text-sm font-black text-white shadow-[0_10px_22px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
              >
                {loading ? loadingSpinner : null}
                <span>{loading ? submittingLabel : (isLogin ? copy.loginSubmit : copy.signupSubmit)}</span>
                {!loading ? <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /> : null}
              </button>
            </form>

            <div className="my-6 flex items-center">
              <div className="h-px flex-grow bg-slate-200" />
              <span className="px-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                {copy.orGoogle}
              </span>
              <div className="h-px flex-grow bg-slate-200" />
            </div>

            <button
              type="button"
              onClick={() => void onGoogleSignIn()}
              disabled={loading}
              aria-busy={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-blue-700 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? loadingSpinner : <Chrome className="h-4 w-4 text-blue-600" />}
              <span>{loading ? googleSubmittingLabel : copy.googleOneClick}</span>
            </button>

            {errorText ? (
              <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-normal text-rose-700">{errorText}</p>
            ) : null}
            {infoText ? (
              <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs leading-normal text-emerald-700">{infoText}</p>
            ) : null}
            {errorText && isLogin && errorText.includes("Invalid login") ? (
              <p className="mt-2 text-center text-xs leading-relaxed text-slate-500">{copy.loginFailedHint}</p>
            ) : null}
            {infoText === copy.signupCheckEmail ? (
              <p className="mt-2 text-center text-xs leading-relaxed text-slate-500">{copy.resendVerify}</p>
            ) : null}
          </div>
        </div>

        <div className="relative z-10 text-center font-mono text-[10px] text-slate-500">
          © {new Date().getFullYear()} PolyWeather
        </div>
      </div>
    </div>
  );
}
