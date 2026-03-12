"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Copy,
  Crown,
  Fingerprint,
  Hash,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  User as UserIcon,
  UserCheck,
} from "lucide-react";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";

type AuthMeResponse = {
  authenticated?: boolean;
  user_id?: string | null;
  email?: string | null;
  entitlement_mode?: string | null;
  auth_required?: boolean;
  subscription_required?: boolean;
  subscription_active?: boolean | null;
};

type InfoItemProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  status?: "default" | "primary";
};

function formatTime(value: string | undefined | null, locale: string) {
  if (!value) return "--";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "--";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dt);
  } catch {
    return "--";
  }
}

function normalizeProvider(user: User | null) {
  const provider = String(user?.app_metadata?.provider || "").trim().toLowerCase();
  if (provider) return provider;
  const providers = user?.app_metadata?.providers;
  if (Array.isArray(providers) && providers.length) {
    return String(providers[0] || "").trim().toLowerCase();
  }
  return "";
}

function InfoItem({ icon: Icon, label, value, status = "default" }: InfoItemProps) {
  return (
    <div className="group flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 p-4 transition-all hover:bg-white/10">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-slate-800 p-2 text-slate-400 transition-colors group-hover:text-blue-400">
          <Icon size={18} />
        </div>
        <span className="text-sm font-medium text-slate-400">{label}</span>
      </div>
      <span
        className={`text-sm font-semibold ${
          status === "primary" ? "text-blue-400" : "text-slate-200"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function AccountCenter() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [copied, setCopied] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [user, setUser] = useState<User | null>(null);
  const [backend, setBackend] = useState<AuthMeResponse | null>(null);

  const supabaseReady = hasSupabasePublicEnv();

  const loadSnapshot = useCallback(async () => {
    setErrorText("");
    try {
      const userPromise = supabaseReady
        ? getSupabaseBrowserClient().auth.getUser()
        : Promise.resolve({ data: { user: null as User | null } });
      const backendPromise = fetch("/api/auth/me", { cache: "no-store" });

      const [userResult, backendResult] = await Promise.all([
        userPromise,
        backendPromise,
      ]);

      setUser(userResult.data?.user ?? null);

      if (!backendResult.ok) {
        const raw = (await backendResult.text()).slice(0, 260);
        throw new Error(`HTTP ${backendResult.status} ${raw}`.trim());
      }

      const backendJson = (await backendResult.json()) as AuthMeResponse;
      setBackend(backendJson);
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      setErrorText(String(error));
    }
  }, [supabaseReady]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      await loadSnapshot();
      if (!cancelled) setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSnapshot();
    setRefreshing(false);
  };

  const onSignOut = async () => {
    if (supabaseReady) {
      try {
        await getSupabaseBrowserClient().auth.signOut();
      } catch {}
    }
    router.replace("/");
  };

  const userId = backend?.user_id || user?.id || "";
  const isAuthenticated = Boolean(userId);
  const email = backend?.email || user?.email || "";
  const displayName =
    String(user?.user_metadata?.full_name || "").trim() ||
    (email ? String(email).split("@")[0] : "") ||
    "PolyWeather 用户";
  const initials = (displayName.slice(0, 2) || "PW").toUpperCase();
  const providerRaw = normalizeProvider(user);
  const provider = providerRaw ? providerRaw.toUpperCase() : "--";
  const lastSignIn = formatTime(
    user?.last_sign_in_at,
    typeof navigator !== "undefined" ? navigator.language : "zh-CN",
  );
  const updatedAtLabel = formatTime(
    updatedAt,
    typeof navigator !== "undefined" ? navigator.language : "zh-CN",
  );

  const modeLabel = useMemo(() => {
    const mode = String(backend?.entitlement_mode || "").trim().toLowerCase();
    if (mode === "supabase_required") return "Supabase 强制登录";
    if (mode === "supabase_optional") return "Supabase 可选登录";
    if (mode === "legacy_token") return "Legacy Token 鉴权";
    if (mode === "disabled") return "未启用鉴权";
    return "未知模式";
  }, [backend?.entitlement_mode]);

  const backendStatus = useMemo(() => {
    if (backend?.authenticated) return "通过";
    if (backend?.auth_required) return "未登录";
    return "游客模式";
  }, [backend?.authenticated, backend?.auth_required]);

  const subscriptionRequirement = backend?.subscription_required
    ? "已启用订阅校验"
    : "当前未强制订阅";
  const subscriptionResult = !backend?.subscription_required
    ? "当前未强制订阅"
    : backend?.subscription_active
    ? "有效订阅"
    : "无有效订阅";

  const bindCommand = userId
    ? `/bind ${userId}${email ? ` ${email}` : ""}`
    : "/bind <supabase_user_id> <email>";

  const copyBindCommand = async () => {
    try {
      await navigator.clipboard.writeText(bindCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0b0f1a] p-4 font-sans text-slate-200 md:p-8">
      <div className="pointer-events-none absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />

      <div className="relative z-10 mx-auto max-w-5xl">
        <header className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-2xl font-bold text-transparent">
              账户中心
            </h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
              <Shield size={14} /> 管理您的身份、权限与 Bot 绑定
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm transition-all active:scale-95 hover:bg-white/10"
            >
              <ChevronLeft size={16} /> 返回看板
            </Link>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing || loading}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm transition-all active:scale-95 hover:bg-white/10 disabled:opacity-70"
            >
              {refreshing || loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              刷新
            </button>
            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400 transition-all active:scale-95 hover:bg-red-500/20"
              >
                <LogOut size={16} /> 退出登录
              </button>
            ) : (
              <Link
                href="/auth/login?next=%2Faccount"
                className="flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-300 transition-all active:scale-95 hover:bg-blue-500/20"
              >
                <LogIn size={16} /> 登录 / 注册
              </Link>
            )}
          </div>
        </header>

        {errorText ? (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            加载失败: {errorText}
          </div>
        ) : null}

        {!supabaseReady ? (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 未配置。
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-br from-white/10 to-transparent p-8 shadow-2xl backdrop-blur-md lg:col-span-12">
            <div className="absolute right-0 top-0 p-6">
              <span className="font-mono text-xs text-slate-500">
                最近同步: {updatedAtLabel}
              </span>
            </div>

            <div className="flex flex-col items-center gap-8 md:flex-row">
              <div className="group relative">
                <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-400 text-3xl font-bold shadow-xl shadow-blue-500/20">
                  {initials}
                </div>
                <div className="absolute -inset-2 bg-blue-500/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
              </div>

              <div className="flex-grow text-center md:text-left">
                <div className="mb-2 flex flex-col items-center gap-3 md:flex-row">
                  <h2 className="text-3xl font-bold">{displayName}</h2>
                  <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-400">
                    <UserCheck size={12} />
                    {isAuthenticated ? "已登录" : "游客模式"}
                  </span>
                </div>
                <p className="font-mono text-slate-400">{email || "--"}</p>
              </div>

              <div className="flex gap-4">
                <div className="min-w-[120px] rounded-2xl border border-white/5 bg-black/20 px-6 py-4 text-center">
                  <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">
                    当前角色
                  </p>
                  <p className="flex items-center justify-center gap-2 font-bold text-white">
                    <Crown size={14} className="text-yellow-500" /> Free Tier
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 lg:col-span-6">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
              <h3 className="mb-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-blue-400">
                <Shield size={16} /> 会员与权限
              </h3>
              <div className="space-y-3">
                <InfoItem icon={Shield} label="鉴权模式" value={modeLabel} status="primary" />
                <InfoItem icon={UserIcon} label="后端状态" value={backendStatus} />
                <InfoItem icon={Crown} label="订阅要求" value={subscriptionRequirement} />
                <InfoItem icon={CheckCircle2} label="订阅结果" value={subscriptionResult} />
              </div>
            </section>
          </div>

          <div className="space-y-6 lg:col-span-6">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
              <h3 className="mb-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-indigo-400">
                <Fingerprint size={16} /> 身份信息
              </h3>
              <div className="space-y-3">
                <InfoItem icon={Mail} label="邮箱" value={email || "--"} />
                <InfoItem icon={Hash} label="用户 ID" value={userId || "--"} />
                <InfoItem icon={LogIn} label="登录方式" value={provider} />
                <InfoItem icon={Clock} label="最近登录" value={lastSignIn} />
              </div>
            </section>
          </div>

          <div className="lg:col-span-12">
            <section className="group relative overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-r from-blue-600/10 to-indigo-600/10 p-8 backdrop-blur-sm">
              <div className="absolute right-0 top-0 translate-x-1/4 -translate-y-1/4">
                <Bot
                  size={200}
                  className="rotate-12 text-blue-500/5 transition-transform duration-700 group-hover:rotate-0"
                />
              </div>

              <div className="relative z-10">
                <h3 className="mb-2 flex items-center gap-2 text-lg font-bold">
                  <Bot size={20} className="text-blue-400" /> Bot 绑定
                </h3>
                <p className="mb-6 max-w-2xl text-sm text-slate-400">
                  将下面命令发送至 Telegram Bot，即可把网页账户与机器人权限绑定，实现全平台气象推送。
                </p>

                <div className="flex flex-col gap-3 md:flex-row">
                  <div className="flex flex-grow items-center rounded-xl border border-white/10 bg-black/40 px-4 py-4 font-mono text-sm text-blue-300">
                    {bindCommand}
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyBindCommand()}
                    className={`flex items-center justify-center gap-2 rounded-xl px-8 py-4 font-bold transition-all active:scale-95 ${
                      copied
                        ? "bg-green-500 text-white"
                        : "bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"
                    }`}
                  >
                    {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                    {copied ? "已复制" : "复制命令"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer className="mt-12 text-center text-xs text-slate-600">
          <p>© 2026 PolyWeather 全球高精度气象引擎 - 云端身份管理系统</p>
        </footer>
      </div>
    </div>
  );
}
