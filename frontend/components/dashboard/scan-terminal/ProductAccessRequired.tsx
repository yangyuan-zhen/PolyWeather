"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CreditCard,
  LogIn,
  RefreshCw,
} from "lucide-react";

const ACCESS_TERM = {
  signInToContinue: { en: "Sign in to continue", zh: "请先登录" },
  proAccessRequired: {
    en: "Subscription expired",
    zh: "订阅已过期",
  },
  month: { en: "/ 30 days", zh: "/ 30 天" },
  subscribeNow: {
    en: "Renew and restore access",
    zh: "续费并恢复访问",
  },
  backToProduct: { en: "Back to product overview", zh: "返回产品介绍页" },
} as const;

function t(key: keyof typeof ACCESS_TERM, isEn: boolean) {
  return isEn ? ACCESS_TERM[key].en : ACCESS_TERM[key].zh;
}

function isExpiredSubscription(expiresAt?: string | null) {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function formatSubscriptionDate(expiresAt: string | null | undefined, isEn: boolean) {
  if (!expiresAt) return "";
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return "";
  try {
    return new Intl.DateTimeFormat(isEn ? "en-US" : "zh-CN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(timestamp));
  } catch {
    return "";
  }
}

// ─── Layer 2: Authenticated but no active subscription ───────────────────────
function SubscriptionGate({
  isEn,
  subscriptionExpiresAt,
}: {
  isEn: boolean;
  subscriptionExpiresAt?: string | null;
}) {
  const expired = isExpiredSubscription(subscriptionExpiresAt);
  const expiryLabel = formatSubscriptionDate(subscriptionExpiresAt, isEn);
  const features = isEn
    ? [
        "Real-time station and METAR signals",
        "DEB forecast curves and model comparison",
        "Full terminal grid with high-frequency refresh",
        "API and paid Telegram group access on paid Pro",
      ]
    : [
        "实时气象站与 METAR 信号",
        "DEB 预测曲线与模型对比",
        "完整终端网格与高频刷新",
        "付费 Pro 可进入 API 与付费 Telegram 群",
      ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#e9edf3] p-6">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-amber-800">
            <AlertTriangle size={13} />
            {expired
              ? t("proAccessRequired", isEn)
              : isEn
                ? "No active subscription"
                : "无有效订阅"}
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-amber-200 bg-amber-50 px-8 py-5 text-amber-950">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
                  {isEn ? "Access paused" : "终端访问已暂停"}
                </p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  {expired
                    ? isEn
                      ? "Your subscription has expired"
                      : "订阅已过期，终端访问已暂停"
                    : isEn
                      ? "No active Pro subscription"
                      : "未检测到有效订阅"}
                </h1>
              </div>
              <span className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-800">
                {expiryLabel
                  ? isEn
                    ? `Expired ${expiryLabel}`
                    : `到期日 ${expiryLabel}`
                  : isEn
                    ? "Action required"
                    : "需要处理"}
              </span>
            </div>
          </div>

          <div className="px-8 pt-6">
            <h1 className="text-xl font-black tracking-tight">
              {isEn
                ? "Renew to restore the Weather Terminal"
                : "续费后恢复天气决策台访问"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {isEn
                ? "Your account is verified, but it does not currently have an active subscription. Renewing restores live temperature evidence, DEB paths, settlement alerts, and paid Telegram/API access."
                : "你的账号已验证，但当前没有有效订阅。续费后会立即恢复实时温度、DEB 路径、结算提醒和付费 Telegram/API 权益。"}
            </p>
          </div>

          <div className="p-8">
            <div className="mb-6 flex items-baseline gap-1">
              <span className="text-4xl font-black text-slate-900">29.9 USDC</span>
              <span className="text-base text-slate-500">
                {t("month", isEn)}
              </span>
            </div>

            <ul className="mb-8 space-y-3">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-blue-600 text-white">
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                      <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href="/account?checkout=1"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
            >
              <CreditCard size={16} />
              {t("subscribeNow", isEn)}
            </Link>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black text-slate-700">
                {isEn
                  ? "Already paid but still blocked?"
                  : "已有付款但未恢复？"}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                >
                  <RefreshCw size={14} />
                  {isEn ? "Refresh access" : "刷新权限"}
                </button>
                <Link
                  href="/account"
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                >
                  {isEn ? "Open account center" : "账户中心"}
                </Link>
              </div>
            </div>

            <p className="mt-4 text-center text-[11px] text-slate-400">
              {isEn
                ? "Access resumes automatically after payment confirmation"
                : "付款确认后会自动恢复访问"}
            </p>
          </div>
        </div>

        <div className="mt-5 text-center">
          <Link
            href="/"
            className="text-xs text-slate-500 hover:text-slate-800 transition-colors"
          >
            ← {t("backToProduct", isEn)}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Layer 1 fallback: Should not normally appear (middleware handles it) ─────
function UnauthenticatedGate({
  isEn,
  userLocalTime,
}: {
  isEn: boolean;
  userLocalTime: string;
}) {
  return (
    <div className="flex h-screen w-full bg-[#e9edf3] text-slate-950">
      <aside className="w-[52px] bg-[#171d24]" />
      <main className="flex flex-1 flex-col">
        <header className="flex h-[64px] items-center justify-between bg-[#171d24] px-4 text-white">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90">
            <img src="/logo.png" alt="PolyWeather" className="h-7 w-auto object-contain" />
            <span className="text-sm font-semibold tracking-tight text-white/90">Terminal</span>
          </Link>
          <div className="font-mono text-sm text-slate-300">{userLocalTime}</div>
        </header>
        <section className="grid flex-1 place-items-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-600">
              <LogIn size={24} />
            </div>
            <h1 className="text-xl font-black text-slate-900">
              {t("signInToContinue", isEn)}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {isEn
                ? "The weather terminal is for verified subscribers only."
                : "天气决策台仅对已验证的付费用户开放。"}
            </p>
            <a
              href="/auth/login?next=%2Fterminal"
              className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-black text-white transition hover:bg-slate-700"
            >
              <LogIn size={15} />
              {isEn ? "Log in" : "登录"}
            </a>
            <a
              href="/auth/login?next=%2Fterminal&mode=signup"
              className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              {isEn ? "Create an account" : "注册账号"}
            </a>
            <a
              href="/"
              className="mt-4 block text-xs text-slate-400 hover:text-slate-700 transition-colors"
            >
              {isEn ? "← Learn about PolyWeather" : "← 了解 PolyWeather"}
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}

export function ProductAccessRequired({
  isAuthenticated,
  isEn,
  subscriptionExpiresAt,
  userLocalTime,
}: {
  isAuthenticated: boolean;
  isEn: boolean;
  subscriptionExpiresAt?: string | null;
  userLocalTime: string;
}) {
  if (!isAuthenticated) {
    return <UnauthenticatedGate isEn={isEn} userLocalTime={userLocalTime} />;
  }
  return (
    <div className="flex h-screen w-full bg-[#e9edf3] text-slate-950">
      <aside className="w-[52px] bg-[#171d24]" />
      <main className="flex flex-1 flex-col">
        <header className="flex h-[64px] items-center justify-between bg-[#171d24] px-4 text-white">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90">
            <img src="/logo.png" alt="PolyWeather" className="h-7 w-auto object-contain" />
            <span className="text-sm font-semibold tracking-tight text-white/90">Terminal</span>
          </Link>
          <div className="font-mono text-sm text-slate-300">{userLocalTime}</div>
        </header>
        <SubscriptionGate
          isEn={isEn}
          subscriptionExpiresAt={subscriptionExpiresAt}
        />
      </main>
    </div>
  );
}
