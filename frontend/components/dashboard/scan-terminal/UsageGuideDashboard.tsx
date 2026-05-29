"use client";

import {
  BookOpenCheck,
  ChartSpline,
  CheckCircle2,
  CircleHelp,
  Eye,
  Gauge,
  Layers3,
  MapPinned,
  Monitor,
  MousePointer2,
  Plane,
  RadioTower,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";

type GuideCopy = {
  title: string;
  body: string;
};

const quickStart: Record<"zh" | "en", GuideCopy[]> = {
  zh: [
    {
      title: "先选城市",
      body: "左上角城市名用于切换当前图表，网格布局可同时观察多个城市。",
    },
    {
      title: "先看实测",
      body: "青绿色粗线是当前更重要的实况锚点，结算跑道或官方站优先于普通机场报文。",
    },
    {
      title: "再看 DEB",
      body: "橙色 DEB Forecast 是融合模型和日内修正后的路径，用来判断后续升温或降温空间。",
    },
    {
      title: "最后看概率",
      body: "紫色区域和虚线表示高概率温度带，适合判断当前实测是否偏离主预期。",
    },
  ],
  en: [
    {
      title: "Pick cities first",
      body: "Use the city name in each chart header to switch slots and monitor multiple cities in the grid.",
    },
    {
      title: "Read live evidence",
      body: "The teal anchor is the key live observation layer; settlement runway or official station data takes priority.",
    },
    {
      title: "Compare DEB",
      body: "The orange DEB Forecast blends model context with intraday correction to frame the remaining move.",
    },
    {
      title: "Check probability",
      body: "The purple band and dotted line show the high-probability temperature zone for fast deviation checks.",
    },
  ],
};

const legendItems: Record<"zh" | "en", GuideCopy[]> = {
  zh: [
    { title: "实测 / 结算线", body: "优先展示结算跑道、官方站或城市核心实况，用于判断已兑现温度。" },
    { title: "DEB Forecast", body: "橙色预测路径，重点看它和实测线在峰值窗口前后的分歧。" },
    { title: "高概率带", body: "紫色带表示当前概率分布的主要落点，虚线是概率均值附近。" },
    { title: "机场报文", body: "METAR / MGM 作为机场站参考，默认只在适合的城市自动显示。" },
    { title: "模型线", body: "ECMWF、GFS、ICON、GEM 等提供背景，默认弱化为辅助判断。" },
    { title: "跑道明细", body: "打开后可查看各跑道传感器，关闭后仍保留结算跑道温度。" },
  ],
  en: [
    { title: "Live / settlement", body: "Settlement runway, official station, or core live observation used as the realized anchor." },
    { title: "DEB Forecast", body: "Orange forecast path; focus on its gap versus live observations near the peak window." },
    { title: "Probability band", body: "Purple band marks the main probability zone, with the dotted line near the probability mean." },
    { title: "Airport reports", body: "METAR / MGM are airport references and are auto-shown only where they are useful by default." },
    { title: "Model lines", body: "ECMWF, GFS, ICON, GEM, and related model layers provide background context." },
    { title: "Runway details", body: "When disabled, the chart still keeps the settlement runway temperature visible." },
  ],
};

const operations: Record<"zh" | "en", GuideCopy[]> = {
  zh: [
    { title: "布局", body: "右上角可切换 1x1 到 3x3，适合从单城复盘切到多城巡检。" },
    { title: "换城市", body: "点击图表标题栏城市名，在当前卡片内搜索并替换城市。" },
    { title: "高温模式", body: "卡片右上角高温按钮用于聚焦最高温兑现窗口。" },
    { title: "曲线显隐", body: "图例可自定义显示机场报文、模型线和跑道明细。" },
  ],
  en: [
    { title: "Layout", body: "Switch from 1x1 to 3x3 in the top-right control for review or multi-city scanning." },
    { title: "Change city", body: "Click the city name in a chart header to search and replace that slot." },
    { title: "High mode", body: "Use the High button to focus the chart on the high-temperature payoff window." },
    { title: "Layer toggles", body: "Use the legend to customize airport reports, model lines, and runway details." },
  ],
};

function GuideCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof BookOpenCheck;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-blue-600">
        <Icon size={18} />
      </div>
      <h3 className="text-sm font-black text-slate-900">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-slate-500">{body}</p>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  eyebrow,
}: {
  icon: typeof BookOpenCheck;
  title: string;
  eyebrow: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-blue-600">
        <Icon size={15} />
      </div>
      <div>
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
          {eyebrow}
        </div>
        <h2 className="text-sm font-black text-slate-900">{title}</h2>
      </div>
    </div>
  );
}

export function UsageGuideDashboard({ isEn }: { isEn: boolean }) {
  const locale = isEn ? "en" : "zh";
  const quickIcons = [MapPinned, RadioTower, ChartSpline, Gauge];
  const legendIcons = [RadioTower, ChartSpline, Sparkles, Plane, Layers3, SlidersHorizontal];

  return (
    <div className="h-full overflow-auto bg-[#f5f7fa]">
      <div className="mx-auto max-w-6xl p-4">
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">
            <BookOpenCheck size={13} />
            {isEn ? "Terminal Guide" : "决策台使用指南"}
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-950">
                {isEn ? "Read the terminal in four passes" : "按四步阅读天气决策台"}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                {isEn
                  ? "Start from live evidence, compare DEB, then use probability and layer toggles to confirm whether the city is moving away from the main path."
                  : "先看实况锚点，再对照 DEB 路径，最后用概率带和图层显隐确认城市是否偏离主预期。"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-bold text-slate-600">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="font-mono text-sm font-black text-slate-950">1-9</div>
                {isEn ? "Charts" : "图表位"}
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="font-mono text-sm font-black text-slate-950">Live</div>
                {isEn ? "Anchor" : "锚点"}
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="font-mono text-sm font-black text-slate-950">DEB</div>
                {isEn ? "Path" : "路径"}
              </div>
            </div>
          </div>
        </div>

        <SectionTitle
          icon={Monitor}
          eyebrow={isEn ? "Quick start" : "快速开始"}
          title={isEn ? "The default reading order" : "默认阅读顺序"}
        />
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {quickStart[locale].map((item, index) => (
            <GuideCard
              key={item.title}
              icon={quickIcons[index]}
              title={`${index + 1}. ${item.title}`}
              body={item.body}
            />
          ))}
        </div>

        <SectionTitle
          icon={Eye}
          eyebrow={isEn ? "Legend" : "图表图例"}
          title={isEn ? "What each layer means" : "每条曲线代表什么"}
        />
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {legendItems[locale].map((item, index) => (
            <GuideCard
              key={item.title}
              icon={legendIcons[index]}
              title={item.title}
              body={item.body}
            />
          ))}
        </div>

        <div className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <SectionTitle
              icon={MousePointer2}
              eyebrow={isEn ? "Controls" : "常用操作"}
              title={isEn ? "Daily workflow controls" : "日常巡检操作"}
            />
            <div className="grid gap-3 md:grid-cols-2">
              {operations[locale].map((item) => (
                <div key={item.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    <h3 className="text-sm font-black text-slate-900">{item.title}</h3>
                  </div>
                  <p className="text-xs leading-5 text-slate-500">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle
              icon={CircleHelp}
              eyebrow={isEn ? "Rules" : "默认规则"}
              title={isEn ? "Visibility and access rules" : "图层和权益规则"}
            />
            <div className="space-y-3">
              {[
                isEn
                  ? "For cities other than Hong Kong and Shenzhen, airport METAR temperature is hidden by default. Users can still enable it manually."
                  : "除香港和深圳外，机场 METAR 温度默认不参与图表展示；用户仍可手动打开。",
                isEn
                  ? "Turkey airport-station curves use MGM data when available, so Ankara and Istanbul should be read from the MGM airport anchor."
                  : "土耳其机场站优先使用 MGM 数据，安卡拉和伊斯坦布尔应以 MGM 机场锚点阅读。",
                isEn
                  ? "The 3-day trial has the same core terminal access as Pro, except the paid Telegram group link is hidden."
                  : "3 天试用拥有和 Pro 一致的核心决策台权益，仅不显示付费 Telegram 群链接。",
              ].map((text) => (
                <div key={text} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-900">
                  {text}
                </div>
              ))}
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <Users size={15} className="text-blue-600" />
                  <h3 className="text-sm font-black text-slate-900">
                    {isEn ? "Pro membership" : "Pro 会员"}
                  </h3>
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  {isEn
                    ? "Monthly and quarterly Pro unlock the full paid workflow, including the Telegram group entry after subscription activation."
                    : "月付和季度 Pro 开通后解锁完整付费工作流，并在账户页显示 Telegram 群入口。"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
