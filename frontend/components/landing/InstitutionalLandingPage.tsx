"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  CloudSun,
  Gauge,
  LineChart,
  LockKeyhole,
  Radar,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { I18nProvider, useI18n } from "@/hooks/useI18n";

const RAW_MARKET_ROWS_EN = [
  ["New York", "91.8°F", "+2.4", "High", "Long Yes"],
  ["Austin", "103.1°F", "+1.1", "Medium", "Wait"],
  ["Seoul", "83.4°F", "-0.7", "Low", "No Trade"],
  ["Tokyo", "88.2°F", "+1.8", "High", "Long Yes"],
  ["London", "72.6°F", "-0.2", "Low", "Observe"],
];

const RAW_MARKET_ROWS_ZH = [
  ["纽约", "91.8°F", "+2.4", "高", "买入多头"],
  ["奥斯汀", "103.1°F", "+1.1", "中", "观望"],
  ["首尔", "83.4°F", "-0.7", "低", "无交易"],
  ["东京", "88.2°F", "+1.8", "高", "买入多头"],
  ["伦敦", "72.6°F", "-0.2", "低", "观察"],
];

const COVERAGE_EN = [
  "Live airport observations",
  "DEB blend forecast",
  "Market-implied temperature",
  "Intraday settlement windows",
  "AI weather evidence",
  "Paid Telegram alerts",
];

const COVERAGE_ZH = [
  "机场实况观测数据",
  "DEB 智能融合预报",
  "市场隐含温度定价",
  "日内分段结算窗口",
  "AI 气象证据链解读",
  "付费电报实时通知",
];

const PRO_FEATURES_EN = [
  "Real-time METAR observations & runway sensor data",
  "Real-time METAR observations & alerts",
  "DEB blend forecast model",
  "Market-implied temperature pricing",
  "Intraday settlement windows & risk metrics",
  "Paid Telegram alerts & Webhook API",
  "24/7 priority professional support",
];

const PRO_FEATURES_ZH = [
  "实时 METAR 机场实测与跑道传感器数据",
  "实时 METAR 机场实测与预警",
  "DEB 智能融合预测模型",
  "市场隐含温度定价与估值",
  "日内结算窗口与风险度量指标",
  "付费电报群通知与 API 接口推送",
  "7×24小时专业技术与客服支持",
];

function InstitutionalLandingScreen() {
  const { locale, toggleLocale } = useI18n();
  const isEn = locale === "en-US";

  const marketRows = isEn ? RAW_MARKET_ROWS_EN : RAW_MARKET_ROWS_ZH;
  const coverage = isEn ? COVERAGE_EN : COVERAGE_ZH;
  const platformCards = isEn
    ? [
        {
          icon: Radar,
          title: "Live Evidence",
          body: "Airport observations and official station data are structured for settlement-aware decisions.",
        },
        {
          icon: Gauge,
          title: "Decision Workflow",
          body: "City cards combine model forecast, current deviation, risk, and target contract context.",
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
          body: "针对机场 METAR 与官方站点数据进行结构化整理，专为结算博弈与交割设计。",
        },
        {
          icon: Gauge,
          title: "决策工作流",
          body: "城市决策卡片融合了气象预报、实况偏差、历史风险系数及目标合约盘口。",
        },
        {
          icon: ShieldCheck,
          title: "付费准入",
          body: "除公开介绍和账户管理外，气象交易决策台仅向付费活跃订阅用户开放。",
        },
      ];

  const modelLabels = isEn
    ? ["DEB Blend", "Live METAR", "Market Implied"]
    : ["DEB 融合预测", "METAR 机场实测", "市场隐含价格"];

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
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold uppercase text-blue-700">
              <LockKeyhole size={13} />
              {isEn ? "Paid professional terminal" : "付费专业交易终端"}
            </div>
            <h1 className="max-w-2xl text-4xl font-black leading-[1.05] tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
              {isEn ? "Institutional weather market intelligence for paid users." : "面向付费用户的机构级天气交易决策台"}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">
              {isEn
                ? "PolyWeather turns live METAR observations, DEB forecast blends, model probabilities, and market settlement logic into one professional decision workspace."
                : "PolyWeather 将 METAR 机场实测、DEB 智能融合预报、模型概率及市场结算逻辑整合于一体，打造气象风险管理专业决策环境。"}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/terminal"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-700 bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                {isEn ? "Enter product" : "进入产品决策台"}
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/account"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-slate-400 hover:text-slate-950"
              >
                {isEn ? "Subscribe / Manage account" : "订阅服务 / 管理账户"}
              </Link>
            </div>
            <p className="mt-4 text-xs font-medium text-slate-500">
              {isEn
                ? "No free product access. Subscription is required before the terminal opens."
                : "无免费公开产品通道。在使用决策台前必须先登录并开通订阅。"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-300 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <BarChart3 size={16} className="text-blue-700" />
                {isEn ? "Weather Markets Dashboard" : "天气市场交易面板"}
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {isEn ? "Live" : "实时数据"}
              </div>
            </div>
            <div className="grid gap-3 p-3 lg:grid-cols-[1fr_0.85fr]">
              <div className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <strong className="text-sm">{isEn ? "Temperature Contracts" : "温度天气合约"}</strong>
                  <span className="text-xs font-semibold text-slate-500">
                    {isEn ? "Price / Edge / Signal" : "价格 / 偏差 / 信号"}
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {marketRows.map((row) => (
                    <div
                      key={row[0]}
                      className="grid grid-cols-[1.1fr_0.8fr_0.6fr_0.7fr_0.9fr] items-center gap-2 px-3 py-3 text-sm"
                    >
                      <span className="font-semibold">{row[0]}</span>
                      <span className="font-mono text-slate-700">{row[1]}</span>
                      <span
                        className={
                          row[2].startsWith("+")
                            ? "font-mono font-bold text-emerald-700"
                            : "font-mono font-bold text-red-600"
                        }
                      >
                        {row[2]}
                      </span>
                      <span className="text-xs font-bold text-slate-500">
                        {row[3]}
                      </span>
                      <span className="rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                        {row[4]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <strong className="text-sm">{isEn ? "Model Stack" : "模型堆栈"}</strong>
                    <LineChart size={16} className="text-blue-700" />
                  </div>
                  <div className="space-y-3">
                    {modelLabels.map((label, index) => (
                      <div key={label}>
                        <div className="mb-1 flex justify-between text-xs font-semibold text-slate-500">
                          <span>{label}</span>
                          <span>{[82, 67, 74][index]}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-blue-600"
                            style={{ width: `${[82, 67, 74][index]}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-800">
                    <TrendingUp size={16} />
                    {isEn ? "Current Signal" : "当前交易信号"}
                  </div>
                  <p className="text-sm leading-6 text-emerald-900">
                    {isEn
                      ? "New York high-temperature market shows a positive observation deviation with confirmed airport evidence."
                      : "纽约高温合约市场出现显著的正向观测偏差，机场天气实况已验证确认。"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
            {platformCards.map(({ body, icon: Icon, title }) => (
              <article
                key={title}
                className="rounded-xl border border-slate-200 bg-slate-50 p-5"
              >
                <Icon className="mb-4 text-blue-700" size={22} />
                <h2 className="text-lg font-bold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="coverage" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-7 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-bold uppercase text-blue-700">
                {isEn ? "Data Coverage" : "数据覆盖范围"}
              </p>
              <h2 className="mt-2 text-3xl font-black">
                {isEn ? "Everything weather-market users need in one place." : "天气市场交易者所需的一切，在此集结。"}
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-slate-600">
              {isEn
                ? "Built for repeat professional use: dense tables, clear status chips, restrained color, and fast entry into paid workflows."
                : "专为高频专业决策设计：高数据密度、直观的状态徽标、严谨的数据呈现，助您快速进入分析流。"}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coverage.map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold shadow-sm"
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
                ? "One plan. Full access. No hidden fees."
                : "一个方案，全部功能，无隐藏费用。"}
            </p>

            <div className="mx-auto mt-16 max-w-lg">
              <div className="relative flex flex-col rounded-3xl border-2 border-blue-600 bg-white p-8 shadow-sm text-left">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-sm">
                  {isEn ? "Pro Terminal" : "专业终端"}
                </div>

                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    PolyWeather Pro
                  </h3>
                  <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                    {isEn
                      ? "Full access to the institutional weather-market terminal. Live METAR, DEB forecasts, probability distribution, AI decision cards, and real-time alerts."
                      : "完整访问机构级天气市场终端。实时 METAR、DEB 预报、概率分布、AI 决策卡片、实时通知。"}
                  </p>
                  <div className="mt-6 flex items-baseline">
                    <span className="text-5xl font-black tracking-tight text-slate-900">
                      $10
                    </span>
                    <span className="ml-1 text-sm font-semibold text-slate-500">
                      / {isEn ? "month" : "月"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {isEn ? "Billed monthly. Cancel anytime." : "按月计费，随时可取消。"}
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
                    className="block w-full rounded-xl bg-slate-950 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  >
                    {isEn ? "Subscribe for $10/month" : "立即订阅 $10/月"}
                  </Link>
                  <p className="mt-3 text-center text-xs text-slate-400">
                    {isEn
                      ? "Login required. Payment via USDC on Polygon."
                      : "需先登录。通过 Polygon 链 USDC 支付。"}
                  </p>
                </div>
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
