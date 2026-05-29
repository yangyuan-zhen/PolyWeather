"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Gauge,
  LineChart,
  LockKeyhole,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";

const COVERAGE_EN = [
  "Live airport observations",
  "DEB blend forecast",
  "Model-implied distribution",
  "Intraday observation windows",
  "AI weather evidence",
  "Paid Telegram alerts",
];

const COVERAGE_ZH = [
  "机场实况观测数据",
  "DEB 智能融合预报",
  "模型隐含分布预测",
  "日内分段观测窗口",
  "AI 气象证据链解读",
  "付费电报实时通知",
];

const PRO_FEATURES_EN = [
  "Real-time METAR observations & runway sensor data",
  "Real-time METAR observations & alerts",
  "DEB blend forecast model",
  "Model-implied distribution analysis",
  "Intraday observation windows & deviation metrics",
  "Paid Telegram alerts & Webhook API",
  "24/7 priority professional support",
];

const PRO_FEATURES_ZH = [
  "实时 METAR 机场实测与跑道传感器数据",
  "实时 METAR 机场实测与预警",
  "DEB 智能融合预测模型",
  "模型隐含分布预测与估算",
  "日内观测窗口与偏差度量指标",
  "付费电报群通知与 API 接口推送",
  "7×24小时专业技术与客服支持",
];

function InstitutionalLandingScreen() {
  const { locale, toggleLocale } = useI18n();
  const isEn = locale === "en-US";
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!hasSupabasePublicEnv()) {
      setAuthChecked(true);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session?.user);
      setAuthChecked(true);
    });
  }, []);

  const coverage = isEn ? COVERAGE_EN : COVERAGE_ZH;
  const platformCards = isEn
    ? [
        {
          icon: Radar,
          title: "Live Evidence",
          body: "Airport observations and official station data are structured for deviation-aware decisions.",
        },
        {
          icon: Gauge,
          title: "Decision Workflow",
          body: "City cards combine model forecast, current deviation, risk, and target threshold context.",
        },
        {
          icon: ShieldCheck,
          title: "Paid Access",
          body: "The product workspace is locked until the user has an active subscription.",
        },
      ]
    : [
        {
          icon: Radar,
          title: "实况证据",
          body: "针对机场 METAR 与官方站点数据进行结构化整理，专为气象决策设计。",
        },
        {
          icon: Gauge,
          title: "决策工作流",
          body: "城市决策卡片依赖了气象预报、实测气温、偏差系数及目标阈值条件。",
        },
        {
          icon: ShieldCheck,
          title: "付费准入",
          body: "除公开介绍和账户管理外，气象决策台仅向付费活跃订阅用户开放。",
        },
      ];

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center hover:opacity-90">
            <img src="/logo.png" alt="PolyWeather" className="h-8 w-auto object-contain" />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
            <a href="#platform" className="hover:text-slate-950">
              {isEn ? "Platform" : "平台简介"}
            </a>
            <a href="#coverage" className="hover:text-slate-950">
              {isEn ? "Data Coverage" : "数据覆盖"}
            </a>
            <a href="#pricing" className="hover:text-slate-950">
              {isEn ? "Pricing" : "价格说明"}
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 text-xs font-bold text-slate-500 shadow-sm transition hover:border-slate-400 hover:text-slate-900"
              onClick={toggleLocale}
            >
              <span className={`px-2 py-1 rounded-md transition-colors ${!isEn ? "bg-blue-50 text-blue-700 font-bold" : "hover:text-slate-800"}`}>中文</span>
              <span className={`px-2 py-1 rounded-md transition-colors ${isEn ? "bg-blue-50 text-blue-700 font-bold" : "hover:text-slate-800"}`}>EN</span>
            </button>
            {!authChecked ? (
              <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-100" />
            ) : isAuthenticated ? (
              <div className="flex items-center gap-3">
                <Link
                  href="/terminal"
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                >
                  {isEn ? "Enter Product" : "进入产品"}
                  <ArrowRight size={15} />
                </Link>
                <Link
                  href="/account"
                  className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-slate-900 border border-slate-300 hover:bg-slate-300 transition-colors"
                  title={isEn ? "Account Settings" : "账户设置"}
                >
                  <svg className="h-5 w-5 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </Link>
              </div>
            ) : (
              <>
                <Link
                  href="/auth/login?next=%2Fterminal"
                  className="hidden rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950 sm:inline-flex"
                >
                  {isEn ? "Log in" : "登录"}
                </Link>
                <Link
                  href="/auth/login?next=%2Fterminal&mode=signup"
                  className="hidden rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 sm:inline-flex"
                >
                  {isEn ? "Sign Up" : "注册"}
                </Link>
                <Link
                  href="/auth/login?next=%2Fterminal"
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                >
                  {isEn ? "Enter Product" : "进入产品"}
                  <ArrowRight size={15} />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div className="animate-fade-in">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200/60 bg-blue-50/80 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-blue-700 shadow-sm backdrop-blur-sm animate-fade-up [animation-delay:150ms] opacity-0">
              <LockKeyhole size={14} className="text-blue-600" />
              {isEn ? "Paid professional dashboard" : "付费专业气象决策台"}
            </div>
            <h1 className="max-w-3xl text-4xl font-black leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-[4rem] lg:leading-[1.05] animate-fade-up [animation-delay:300ms] opacity-0">
              {isEn ? (
                <>
                  Institutional weather intelligence for{" "}
                  <span className="inline-block text-transparent bg-clip-text bg-[linear-gradient(to_right,#2563eb,#8b5cf6,#2563eb)] bg-[length:200%_auto] animate-gradient">
                    professional teams.
                  </span>
                </>
              ) : (
                <>
                  面向专业团队的机构级{" "}
                  <span className="inline-block text-transparent bg-clip-text bg-[linear-gradient(to_right,#2563eb,#8b5cf6,#2563eb)] bg-[length:200%_auto] animate-gradient pb-2">
                    天气决策台
                  </span>
                </>
              )}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-500 sm:text-lg animate-fade-up [animation-delay:450ms] opacity-0">
              {isEn
                ? "PolyWeather turns live METAR observations, DEB forecast blends, model probabilities, and deviation verification logic into one professional decision workspace."
                : "PolyWeather 将 METAR 机场实测、DEB 智能融合预报、模型概率及偏差校验逻辑整合于一体，打造气象风险管理专业决策环境。"}
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row animate-fade-up [animation-delay:600ms] opacity-0">
              <Link
                href={authChecked && isAuthenticated ? "/terminal" : "/auth/login?next=%2Fterminal"}
                className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-blue-700 bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 hover:shadow-blue-600/30 hover:-translate-y-0.5"
              >
                {isEn ? "Enter product" : "进入产品决策台"}
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/account"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950 hover:-translate-y-0.5"
              >
                {isEn ? "Subscribe / Manage account" : "订阅服务 / 管理账户"}
              </Link>
            </div>
            <p className="mt-5 text-xs font-medium text-slate-400 animate-fade-up [animation-delay:750ms] opacity-0">
              {isEn
                ? "No free product access. Subscription is required before the terminal opens."
                : "无免费公开产品通道。在使用决策台前必须先登录并开通订阅。"}
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.16)] animate-fade-up [animation-delay:650ms] opacity-0">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <LineChart size={16} className="text-blue-700" />
                {isEn ? "Realtime Terminal" : "实时终端"}
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                {isEn ? "Real product screenshot" : "真实产品截图"}
              </div>
            </div>
            <div className="bg-slate-50 p-2 sm:p-3">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <img
                  src="/static/web.png"
                  alt={isEn ? "PolyWeather realtime terminal screenshot" : "PolyWeather 实时终端截图"}
                  className="block h-auto w-full object-contain"
                  loading="eager"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
            {platformCards.map(({ body, icon: Icon, title }, i) => (
              <article
                key={title}
                className="rounded-xl border border-slate-200 bg-slate-50 p-5 animate-fade-up opacity-0 transition-all hover:-translate-y-1 hover:shadow-md hover:border-slate-300 duration-300"
                style={{ animationDelay: `${200 + i * 150}ms`, animationFillMode: "forwards" }}
              >
                <Icon className="mb-4 text-blue-700" size={22} />
                <h2 className="text-lg font-bold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="coverage" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 overflow-hidden">
          <div className="mb-7 flex flex-col justify-between gap-3 md:flex-row md:items-end animate-fade-up opacity-0" style={{ animationDelay: "300ms", animationFillMode: "forwards" }}>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
                {isEn ? "Data Coverage" : "数据覆盖范围"}
              </p>
              <h2 className="mt-3 text-3xl font-black sm:text-4xl">
                {isEn ? "Everything weather intelligence users need in one place." : "气象决策分析人员所需的一切，在此集结。"}
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-slate-500">
              {isEn
                ? "Built for repeat professional use: dense tables, clear status chips, restrained color, and fast entry into paid workflows."
                : "专为高频专业决策设计：高数据密度、直观的状态徽标、严谨的数据呈现，助您快速进入分析流。"}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coverage.map((item, i) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold shadow-sm animate-fade-up opacity-0 transition-all hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 duration-300"
                style={{ animationDelay: `${400 + i * 100}ms`, animationFillMode: "forwards" }}
              >
                <CheckCircle2 size={17} className="text-emerald-600" />
                {item}
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="border-t border-slate-200 bg-white py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
              {isEn ? "PRICING" : "价格方案"}
            </p>
            <h2 className="mt-3 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
              {isEn ? "Simple, transparent pricing" : "简单透明的定价"}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-slate-500">
              {isEn
                ? "Start with a 3-day trial, then choose monthly or quarterly Pro access."
                : "新用户可先领 3 天免费试用，再选择月付或季度 Pro。"}
            </p>

            <div className="mx-auto mt-16 grid max-w-5xl gap-4 text-left md:grid-cols-3">
              <div className="relative flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm animate-fade-up opacity-0" style={{ animationDelay: "420ms", animationFillMode: "forwards" }}>
                <div className="mb-4 inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  {isEn ? "Trial" : "试用"}
                </div>
                <h3 className="text-2xl font-black text-slate-900">
                  {isEn ? "3-day free trial" : "3 天免费试用"}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                  {isEn
                    ? "New users receive one signup trial for core product workflows. Paid Telegram group, high-frequency refresh, batch alerts, and API access require Pro."
                    : "新用户首次注册/登录后自动开通一次 3 天免费试用，可体验核心产品；付费 Telegram 群、高频刷新、批量提醒与 API 需 Pro。"}
                </p>
                <Link
                  href="/auth/login?next=%2Fterminal&mode=signup"
                  className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-700 bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700"
                >
                  {isEn ? "Start trial" : "开始试用"}
                  <ArrowRight size={15} />
                </Link>
              </div>

              <div className="relative flex flex-col rounded-2xl border-2 border-blue-500/80 bg-white p-6 shadow-[0_20px_60px_rgba(37,99,235,0.12)] animate-fade-up opacity-0 transition-transform hover:-translate-y-1 hover:shadow-[0_30px_80px_rgba(37,99,235,0.18)] duration-500" style={{ animationDelay: "500ms", animationFillMode: "forwards" }}>
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-1.5 text-xs font-bold uppercase tracking-widest text-white shadow-md">
                  {isEn ? "Pro Workspace" : "专业决策分析台"}
                </div>

                <div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                    {isEn ? "Pro Monthly" : "Pro 月付"}
                  </h3>
                  <p className="mt-3 text-sm text-slate-500 leading-relaxed">
                    {isEn
                      ? "Full Pro access for 30 days, including paid Telegram group eligibility."
                      : "完整 Pro 权限 30 天，包含付费 Telegram 群准入资格。"}
                  </p>
                  <div className="mt-6 flex items-baseline">
                    <span className="text-5xl font-black tracking-tight text-slate-900">
                      29.9
                    </span>
                    <span className="ml-1 text-sm font-semibold text-slate-500">
                      USDC / 30 天
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {isEn
                      ? "Referral first-month price: 26.9 USDC."
                      : "使用邀请码首月 26.9 USDC。"}
                  </p>

                  <div className="mt-8 border-t border-slate-100 pt-6">
                    <ul className="space-y-4">
                      {(isEn ? PRO_FEATURES_EN : PRO_FEATURES_ZH).map((feature) => (
                        <li key={feature} className="flex items-start gap-3">
                          <Check size={16} className="mt-0.5 shrink-0 text-blue-600" />
                          <span className="text-sm text-slate-700 font-semibold leading-normal">
                            {feature}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-8">
                  <Link
                    href="/account"
                    className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 py-3.5 text-center text-sm font-bold text-white shadow-lg shadow-slate-900/20 transition-all hover:scale-[1.02] hover:shadow-slate-900/30 hover:from-blue-600 hover:to-indigo-600 duration-300 active:scale-[0.98]"
                  >
                    <span>{isEn ? "Subscribe monthly" : "订阅月付 Pro"}</span>
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                  </Link>
                  <p className="mt-4 text-center text-xs text-slate-400">
                    {isEn
                      ? "Login required. Payment via USDC on Polygon."
                      : "需先登录。通过 Polygon 链 USDC 支付。"}
                  </p>
                </div>
              </div>

              <div className="relative flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm animate-fade-up opacity-0" style={{ animationDelay: "580ms", animationFillMode: "forwards" }}>
                <div className="mb-4 inline-flex w-fit rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
                  {isEn ? "Quarterly" : "季度"}
                </div>
                <h3 className="text-2xl font-black text-slate-900">
                  {isEn ? "Pro Quarterly" : "Pro 季度"}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                  {isEn
                    ? "90 days of Pro access at a lower effective monthly cost."
                    : "90 天 Pro 权限，适合稳定使用，折算月成本更低。"}
                </p>
                <div className="mt-6 flex items-baseline">
                  <span className="text-5xl font-black tracking-tight text-slate-900">
                    79.9
                  </span>
                  <span className="ml-1 text-sm font-semibold text-slate-500">
                    USDC / 90 天
                  </span>
                </div>
                <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-800">
                  {isEn
                    ? "Invite reward: invited user pays Pro, referrer gets +3 days Pro."
                    : "邀请奖励：被邀请人成功付费后，邀请人 +3 天 Pro。"}
                </div>
                <Link
                  href="/account"
                  className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  {isEn ? "Choose quarterly" : "选择季度 Pro"}
                  <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export function InstitutionalLandingPage() {
  return (
    <I18nProvider>
      <InstitutionalLandingScreen />
    </I18nProvider>
  );
}
