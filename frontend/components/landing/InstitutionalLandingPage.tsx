import Link from "next/link";
import { cookies, headers } from "next/headers";
import { LandingAnalytics } from "@/components/landing/LandingAnalytics";
import {
  LandingHeaderActions,
  LandingHeroActions,
} from "@/components/landing/LandingAuthActions";
import {
  LANDING_LOCALE_COOKIE,
  pickLandingLocale,
  type LandingLocale,
} from "@/components/landing/landingLocale";

const COVERAGE_EN = [
  "AMOS 60s runway sensors",
  "AMSC 180s runway endpoints",
  "MADIS 300s airport observations",
  "CoWIN 60s + HKO 600s",
  "SSE patch live terminal",
  "Telegram reads latest cache",
];

const COVERAGE_ZH = [
  "AMOS 60s 跑道传感器",
  "AMSC 180s 跑道端点",
  "MADIS 300s 机场观测",
  "CoWIN 60s + HKO 600s",
  "SSE patch 实时终端",
  "Telegram 读取最新缓存",
];

const PRO_FEATURES_EN = [
  "Settlement-source-first airport, official-station, and runway observations",
  "DEB blend forecast with model-spread context",
  "Model-implied distribution and probability estimates",
  "Intraday windows, deviation metrics, and settlement context",
  "Paid Telegram group eligibility and alert workflows",
  "Priority support for subscription and access issues",
];

const PRO_FEATURES_ZH = [
  "结算源优先的机场、官方站与跑道实测",
  "DEB 智能融合预报与模型分歧背景",
  "模型隐含分布预测与概率估算",
  "日内观测窗口、偏差度量与结算背景",
  "付费 Telegram 群准入与提醒工作流",
  "订阅与准入问题优先支持",
];

type IconName =
  | "radar"
  | "gauge"
  | "shield"
  | "cloudSun"
  | "lineChart"
  | "bell"
  | "clock"
  | "database"
  | "check"
  | "arrow";

function LandingIcon({
  className,
  name,
  size = 16,
}: {
  className?: string;
  name: IconName;
  size?: number;
}) {
  const common = {
    "aria-hidden": true,
    className,
    fill: "none",
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    width: size,
  };

  switch (name) {
    case "radar":
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 1 0 9 9" />
          <path d="M12 7a5 5 0 1 0 5 5" />
          <path d="M12 12l7-7" />
          <path d="M16 4h4v4" />
        </svg>
      );
    case "gauge":
      return (
        <svg {...common}>
          <path d="M4 14a8 8 0 1 1 16 0" />
          <path d="M12 14l4-4" />
          <path d="M8 18h8" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.3-2.8 8.1-7 9-4.2-.9-7-4.7-7-9V6l7-3Z" />
          <path d="M9 12l2 2 4-5" />
        </svg>
      );
    case "cloudSun":
      return (
        <svg {...common}>
          <path d="M8 14.5a4 4 0 0 1 7.8-1.2A3.3 3.3 0 1 1 17 20H8.5a2.8 2.8 0 0 1-.5-5.5Z" />
          <path d="M16 3v2" />
          <path d="M20.2 4.8l-1.4 1.4" />
          <path d="M21 10h-2" />
          <path d="M12 4.8l1.4 1.4" />
        </svg>
      );
    case "lineChart":
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M7 15l3-4 3 2 4-6" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 9a6 6 0 0 1 12 0c0 6 2 6 2 8H4c0-2 2-2 2-8Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M5 12.5l4 4L19 7" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      );
    default:
      return null;
  }
}

function WeatherWorkflowIllustration() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-16 z-0 mx-auto hidden h-[240px] max-w-6xl overflow-hidden md:block"
    >
      <div className="absolute left-8 top-14 h-24 w-24 rotate-[-7deg] rounded-lg border-2 border-slate-900 bg-[#fff3b0] shadow-[6px_6px_0_rgba(15,23,42,0.12)]" />
      <div className="absolute right-14 top-10 h-20 w-28 rotate-[6deg] rounded-lg border-2 border-slate-900 bg-[#dff8ea] shadow-[6px_6px_0_rgba(15,23,42,0.12)]" />
    </div>
  );
}

async function resolveLandingLocale(): Promise<LandingLocale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return pickLandingLocale(
    cookieStore.get(LANDING_LOCALE_COOKIE)?.value,
    headerStore.get("accept-language"),
  );
}

function InstitutionalLandingScreen({ locale }: { locale: LandingLocale }) {
  const isEn = locale === "en-US";
  const coverage = isEn ? COVERAGE_EN : COVERAGE_ZH;
  const coverageAccentClasses = [
    "bg-sky-100 text-sky-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
  ];
  const coverageIcons: IconName[] = ["cloudSun", "lineChart", "bell"];

  const platformCards: Array<{ body: string; icon: IconName; title: string }> = isEn
    ? [
        {
          icon: "radar",
          title: "Live Evidence",
          body: "Airport observations, model spreads, and deviation checks stay in one calm workspace.",
        },
        {
          icon: "gauge",
          title: "Daily Review",
          body: "Scan the city board, compare forecasts, and keep the current decision context visible.",
        },
        {
          icon: "shield",
          title: "Access Control",
          body: "Trial users get the same product experience as Pro, except the paid Telegram group link stays hidden.",
        },
      ]
    : [
        {
          icon: "radar",
          title: "实况证据",
          body: "机场观测、模型分歧与偏差校验放在一个安静清晰的工作台里。",
        },
        {
          icon: "gauge",
          title: "每日复盘",
          body: "快速扫描城市面板、比较预报路径，并保留当前判断上下文。",
        },
        {
          icon: "shield",
          title: "权益分层",
          body: "试用期权益和 Pro 一致，唯一例外是不显示付费 Telegram 群链接。",
        },
      ];

  const heroStats = isEn
    ? [
        { label: "Trial", value: "3 days" },
        { label: "Monthly", value: "29.9 USDC" },
        { label: "Quarterly", value: "79.9 USDC" },
        { label: "Referral", value: "20 USDC" },
      ]
    : [
        { label: "试用", value: "3 天" },
        { label: "月付", value: "29.9 USDC" },
        { label: "季度", value: "79.9 USDC" },
        { label: "邀请首月", value: "20 USDC" },
      ];

  return (
    <div className="min-h-screen bg-[#fbfbfa] text-slate-950 antialiased">
      <LandingAnalytics />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-[#fbfbfa]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <img src="/logo.png" alt="PolyWeather" className="h-7 w-auto object-contain" />
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-500 md:flex">
            <a href="#platform" className="hover:text-slate-950">
              {isEn ? "Platform" : "平台"}
            </a>
            <a href="#coverage" className="hover:text-slate-950">
              {isEn ? "Data" : "数据"}
            </a>
            <a href="#screenshots" className="hover:text-slate-950">
              {isEn ? "Screens" : "截图"}
            </a>
            <Link href="/docs/chart-guide" className="hover:text-slate-950">
              {isEn ? "Guide" : "读图"}
            </Link>
            <a href="#pricing" className="hover:text-slate-950">
              {isEn ? "Pricing" : "定价"}
            </a>
          </nav>

          <LandingHeaderActions locale={locale} />
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-slate-200 px-4 pb-16 pt-20 sm:px-6 sm:pt-24">
          <WeatherWorkflowIllustration />
          <div className="relative z-10 mx-auto max-w-6xl">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="text-5xl font-black leading-[1.04] tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
                PolyWeather
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                {isEn
                  ? "A settlement-source-first terminal for temperature markets: live airport/runway observations, DEB, market buckets, and alerts in one workflow."
                  : "面向温度市场的结算源优先终端：机场/跑道实测、DEB、市场温度桶和提醒放在同一个工作流里。"}
              </p>
              <LandingHeroActions locale={locale} />
              <p className="mt-4 text-sm text-slate-500">
                {isEn
                  ? "Start with a one-time 3-day trial. Trial access matches Pro except for the paid Telegram group link."
                  : "新用户可先领一次 3 天试用。试用期权益和 Pro 一致，除了不显示付费 Telegram 群链接。"}
              </p>
            </div>

            <div className="mx-auto mt-14 max-w-5xl rounded-lg border border-slate-200 bg-white p-2 shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
              <div className="flex h-9 items-center gap-2 border-b border-slate-200 px-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b6b]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#ffd166]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#06d6a0]" />
                <span className="ml-2 text-xs font-semibold text-slate-400">
                  polyweather.app/terminal
                </span>
              </div>
              <div className="mt-2 aspect-[16/9] overflow-hidden rounded-md border border-slate-100 bg-slate-100">
                <img
                  src="/static/web.webp"
                  width="680"
                  height="340"
                  alt={isEn ? "PolyWeather terminal preview" : "PolyWeather 终端预览"}
                  className="h-full w-full object-cover object-top"
                  decoding="async"
                  fetchPriority="high"
                  loading="eager"
                  sizes="(min-width: 1024px) 960px, calc(100vw - 48px)"
                />
              </div>
            </div>

            <div className="mx-auto mt-8 grid max-w-5xl gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {heroStats.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm"
                >
                  <div className="font-mono text-lg font-black text-slate-950">
                    {item.value}
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-500">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="platform" className="border-b border-slate-200 bg-white px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {isEn ? "Platform" : "平台能力"}
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                {isEn
                  ? "Built around the station that actually matters."
                  : "围绕真正会影响结算的站点构建。"}
              </h2>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {platformCards.map(({ body, icon, title }) => (
                <article key={title} className="rounded-lg border border-slate-200 bg-[#fbfbfa] p-6 shadow-sm">
                  <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-800">
                    <LandingIcon name={icon} size={19} />
                  </div>
                  <h3 className="text-lg font-black text-slate-950">{title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{body}</p>
                </article>
              ))}
            </div>

            <div className="mt-10 rounded-lg border border-slate-200 bg-[#fbfbfa] p-5">
              <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    {isEn ? "Differentiation" : "差异化卖点"}
                  </p>
                  <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
                    {isEn ? "Settlement-source first, not generic weather." : "结算源优先，不做泛天气看板。"}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {isEn
                      ? "The product is built around the station, runway, and update cadence that affect settlement, then layers DEB, market buckets, and alerting on top."
                      : "产品围绕真正影响结算的站点、跑道和源头频率构建，再叠加 DEB、市场温度桶和提醒工作流。"}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(isEn
                    ? [
                        "Runway-level China and Korea observation context",
                        "Hong Kong CoWIN + HKO dual-source reading",
                        "Source-native collector cadence with SSE patch delivery",
                        "Telegram alerts read cache instead of force-refreshing sources",
                      ]
                    : [
                        "中国和韩国跑道级实测上下文",
                        "香港 CoWIN + HKO 双源读数",
                        "按源频率采集，并用 SSE patch 推送",
                        "Telegram 读取缓存，不强制刷新外部源",
                      ]
                  ).map((item) => (
                    <div key={item} className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold leading-6 text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="screenshots" className="border-b border-slate-200 bg-[#fbfbfa] px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {isEn ? "Product Screenshots" : "产品截图"}
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                {isEn ? "The terminal and alerts are the product." : "终端和提醒就是核心产品。"}
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                {isEn
                  ? "Public packaging should show the actual workflow: live chart reading in the browser and concise runway alerts in Telegram."
                  : "公开包装应该直接展示真实工作流：浏览器里读实时图表，Telegram 里接收简洁的跑道提醒。"}
              </p>
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
              <figure className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                <div className="aspect-[16/9] overflow-hidden rounded-md border border-slate-100 bg-slate-100">
                  <img
                    src="/static/web.webp"
                    width="680"
                    height="340"
                    alt={isEn ? "Realtime terminal screenshot" : "实时终端截图"}
                    className="h-full w-full object-cover object-top"
                    decoding="async"
                    loading="lazy"
                    sizes="(min-width: 1024px) 760px, calc(100vw - 48px)"
                  />
                </div>
                <figcaption className="px-2 py-3 text-xs font-semibold text-slate-500">
                  {isEn ? "Browser terminal: settlement observations, DEB, source cadence, and market context." : "浏览器终端：结算实测、DEB、源头频率和市场上下文。"}
                </figcaption>
              </figure>

              <figure className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                <div className="aspect-[9/16] max-h-[520px] overflow-hidden rounded-md border border-slate-100 bg-slate-100">
                  <img
                    src="/static/tel.png"
                    width="420"
                    height="640"
                    alt={isEn ? "Telegram runway alert screenshot" : "Telegram 跑道提醒截图"}
                    className="h-full w-full object-cover object-top"
                    decoding="async"
                    loading="lazy"
                    sizes="(min-width: 1024px) 340px, calc(100vw - 48px)"
                  />
                </div>
                <figcaption className="px-2 py-3 text-xs font-semibold text-slate-500">
                  {isEn ? "Telegram alerts: concise runway and settlement-source updates for paid users." : "Telegram 提醒：为付费用户提供简洁的跑道与结算源更新。"}
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section id="coverage" className="border-b border-slate-200 bg-[#fbfbfa] px-4 py-20 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {isEn ? "Data Coverage" : "数据覆盖"}
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                {isEn ? "Refresh cadence follows the source, not a fake timer." : "刷新频率跟随源头，不伪装成统一定时器。"}
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                {isEn
                  ? "The collector writes cache and event streams first; the website consumes snapshots plus SSE patches, while Telegram reads the latest cached state."
                  : "采集器先写缓存和事件流；网站消费完整快照 + SSE patch，Telegram 只读取最新缓存状态。"}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link
                  href="/docs/chart-guide"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-950"
                >
                  {isEn ? "Read chart guide" : "查看读图指南"}
                </Link>
                <Link
                  href="/docs/realtime-sources"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-950"
                >
                  {isEn ? "Source cadence" : "数据源频率"}
                </Link>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                {coverage.map((item, index) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-md border border-slate-100 bg-[#fbfbfa] px-4 py-3"
                  >
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-md ${
                        coverageAccentClasses[index % coverageAccentClasses.length]
                      }`}
                    >
                      <LandingIcon name={coverageIcons[index % coverageIcons.length]} />
                    </span>
                    <span className="text-sm font-semibold text-slate-700">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="bg-white px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {isEn ? "Pricing" : "定价"}
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                {isEn
                  ? "Try first, upgrade when it becomes part of your workflow."
                  : "先试用，确认进入工作流后再开通 Pro。"}
              </h2>
              <p className="mt-4 text-base leading-8 text-slate-600">
                {isEn
                  ? "New users receive one 3-day trial. Monthly and quarterly Pro unlock the full entitlement set."
                  : "新用户可领取一次 3 天试用，月付与季度 Pro 解锁完整权益。"}
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col rounded-lg border border-slate-200 bg-[#fbfbfa] p-6 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                  <LandingIcon name="clock" />
                  {isEn ? "Trial" : "试用"}
                </div>
                <h3 className="mt-5 text-2xl font-black text-slate-950">
                  {isEn ? "3-day free trial" : "3 天免费试用"}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">
                  {isEn
                    ? "Automatically granted once after signup. Trial access matches Pro, except trial accounts do not see the paid Telegram group link."
                    : "注册后自动开通一次，体验核心产品；试用期权益和 Pro 一致，除了不显示付费 Telegram 群链接。"}
                </p>
                <Link
                  href="/auth/login?next=%2Fterminal&mode=signup"
                  className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-950"
                >
                  {isEn ? "Start trial" : "开始试用"}
                  <LandingIcon name="arrow" size={15} />
                </Link>
              </div>

              <div className="relative flex flex-col rounded-lg border-2 border-slate-950 bg-white p-6 shadow-[8px_8px_0_rgba(15,23,42,0.12)]">
                <div className="absolute right-4 top-4 rounded-md bg-[#fff3b0] px-2 py-1 text-xs font-black text-slate-900">
                  {isEn ? "Popular" : "常用"}
                </div>
                <div className="flex items-center gap-2 text-sm font-bold text-sky-700">
                  <LandingIcon name="database" />
                  Pro
                </div>
                <h3 className="mt-5 text-2xl font-black text-slate-950">
                  Pro
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {isEn
                    ? "Full terminal access, chart guides, advanced context, and paid Telegram group eligibility."
                    : "完整终端权限、读图指南、高级上下文和付费 Telegram 群准入资格。"}
                </p>
                <div className="mt-7 space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-4xl font-black text-slate-950">29.9</span>
                    <span className="text-sm font-semibold text-slate-500">USDC / 30 天</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-black text-slate-950">79.9</span>
                    <span className="text-sm font-semibold text-slate-500">USDC / 90 天</span>
                  </div>
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  {isEn ? "Referral first month: 20 USDC" : "使用邀请码首月 20 USDC"}
                </p>
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                  {isEn
                    ? "Invite reward: referrer gets +3500 points when invitee subscribes."
                    : "邀请奖励：被邀请人付费后，邀请人 +3500 积分。"}
                </div>
                <ul className="mt-7 space-y-3 border-t border-slate-200 pt-6">
                  {(isEn ? PRO_FEATURES_EN : PRO_FEATURES_ZH).map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <LandingIcon
                        name="check"
                        size={15}
                        className="mt-0.5 shrink-0 text-slate-500"
                      />
                      <span className="text-sm leading-6 text-slate-700">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/account"
                  className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 text-sm font-bold text-white hover:bg-slate-800"
                >
                  {isEn ? "Subscribe monthly" : "订阅月付 Pro"}
                  <LandingIcon name="arrow" size={15} />
                </Link>
              </div>

              <div className="flex flex-col rounded-lg border border-slate-200 bg-[#fbfbfa] p-6 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
                  <LandingIcon name="lineChart" />
                  API
                </div>
                <h3 className="mt-5 text-2xl font-black text-slate-950">
                  {isEn ? "API" : "API"}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">
                  {isEn
                    ? "Not sold as a public product right now. The public site and Telegram workflow remain the supported product surface."
                    : "目前不作为公开产品售卖。当前支持的产品形态仍是网站终端和 Telegram 工作流。"}
                </p>
                <div className="mt-7 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-600">
                  {isEn ? "Not for sale. We will revisit API packaging only after endpoint docs, keys, limits, and support boundaries are ready." : "暂不售卖。只有接口文档、key、限额和支持边界准备好后，才重新评估 API 产品化。"}
                </div>
                <Link
                  href="/docs/realtime-sources"
                  className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-950"
                >
                  {isEn ? "Read data guide" : "查看数据指南"}
                  <LandingIcon name="arrow" size={15} />
                </Link>
              </div>

              <div className="flex flex-col rounded-lg border border-slate-200 bg-[#fbfbfa] p-6 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-violet-700">
                  <LandingIcon name="shield" />
                  Team
                </div>
                <h3 className="mt-5 text-2xl font-black text-slate-950">
                  {isEn ? "Team" : "团队"}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">
                  {isEn
                    ? "For private groups that need shared access, Telegram workflow support, and manual onboarding."
                    : "面向需要共享权限、Telegram 工作流支持和人工开通的私密团队。"}
                </p>
                <div className="mt-7 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-600">
                  {isEn
                    ? "Custom seat and group setup. Best for teams already using the terminal together."
                    : "自定义席位和群组配置，适合已经一起使用终端的团队。"}
                </div>
                <Link
                  href="/subscription-help"
                  className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-950"
                >
                  {isEn ? "Talk to us" : "联系开通"}
                  <LandingIcon name="arrow" size={15} />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export async function InstitutionalLandingPage() {
  const locale = await resolveLandingLocale();
  return <InstitutionalLandingScreen locale={locale} />;
}
