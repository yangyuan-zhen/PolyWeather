"use client";

import Link from "next/link";
import { LockKeyhole, CreditCard, LogIn } from "lucide-react";

const ACCESS_TERM = {
  signInToContinue: { en: "Sign in to continue", zh: "请先登录" },
  proAccessRequired: { en: "Pro subscription required", zh: "需要开通 Pro" },
  month: { en: "/ 30 days", zh: "/ 30 天" },
  subscribeNow: { en: "Subscribe & Activate", zh: "立即订阅并激活" },
  backToProduct: { en: "Back to product overview", zh: "返回产品介绍页" },
} as const;

function t(key: keyof typeof ACCESS_TERM, isEn: boolean) {
  return isEn ? ACCESS_TERM[key].en : ACCESS_TERM[key].zh;
}

// ─── Layer 2: Authenticated but no active subscription ───────────────────────
function SubscriptionGate({ isEn }: { isEn: boolean }) {
  const features = isEn
    ? [
        "Real-time station, METAR, and runway signals",
        "DEB forecast curves and model comparison",
        "Full terminal grid with high-frequency refresh",
        "API and paid Telegram group access on paid Pro",
      ]
    : [
        "实时气象站、METAR 与跑道信号",
        "DEB 预测曲线与模型对比",
        "完整终端网格与高频刷新",
        "付费 Pro 可进入 API 与付费 Telegram 群",
      ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#e9edf3] p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700">
            <LockKeyhole size={12} />
            {t("proAccessRequired", isEn)}
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6 text-white">
            <h1 className="text-xl font-black tracking-tight">
              {isEn
                ? "Unlock the Weather Terminal"
                : "解锁天气决策台"}
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              {isEn
                ? "Your account is verified. One step away from full access."
                : "账号已验证，只差一步即可获得完整访问权限。"}
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
            >
              <CreditCard size={16} />
              {t("subscribeNow", isEn)}
            </Link>

            <p className="mt-4 text-center text-[11px] text-slate-400">
              {isEn
                ? "Cancel anytime · No hidden fees · Instant access after payment"
                : "随时取消 · 无隐藏费用 · 付款后立即解锁"}
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
            <Link
              href="/auth/login?next=%2Fterminal"
              className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-black text-white transition hover:bg-slate-700"
            >
              <LogIn size={15} />
              {isEn ? "Log in" : "登录"}
            </Link>
            <Link
              href="/auth/login?next=%2Fterminal&mode=signup"
              className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              {isEn ? "Create an account" : "注册账号"}
            </Link>
            <Link
              href="/"
              className="mt-4 block text-xs text-slate-400 hover:text-slate-700 transition-colors"
            >
              {isEn ? "← Learn about PolyWeather" : "← 了解 PolyWeather"}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

export function ProductAccessRequired({
  isAuthenticated,
  isEn,
  userLocalTime,
}: {
  isAuthenticated: boolean;
  isEn: boolean;
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
        <SubscriptionGate isEn={isEn} />
      </main>
    </div>
  );
}
