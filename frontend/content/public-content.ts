import type { LandingLocale } from "@/components/landing/landingLocale";

export const PUBLIC_CONTENT_BASE_URL = "https://polyweather.top";

export type PublicBriefSignal = {
  label: string;
  value: string;
  detail: string;
};

export type PublicBrief = {
  city: string;
  cityName: string;
  countryName: string;
  date: string;
  title: string;
  description: string;
  market: string;
  settlementSource: string;
  updatedAt: string;
  publishedAt: string;
  dataFreshness: string;
  debRead: string;
  sourceRead: string;
  modelRead: string;
  riskRead: string;
  notFinancialAdvice: string;
  distributionText: string;
  primaryCtaLabel: string;
  sourceSlugs: string[];
  methodologySlugs: string[];
  signals: PublicBriefSignal[];
  checkpoints: string[];
};

export type MethodologyPage = {
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  summary: string;
  sections: Array<{
    heading: string;
    body: string;
    bullets: string[];
  }>;
};

export type SourcePage = {
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  operator: string;
  coverage: string;
  cadence: string;
  settlementUse: string;
  reliabilityNotes: string[];
  relatedMethodologySlugs: string[];
};

export type PublicContentCopy = {
  allPublicBriefs: string;
  briefIndexDescription: string;
  briefIndexEyebrow: string;
  briefIndexTitle: string;
  checksBeforeActing: string;
  distributionCopy: string;
  docs: string;
  freshness: string;
  market: string;
  methodology: string;
  methodologyIndexDescription: string;
  methodologyIndexEyebrow: string;
  methodologyIndexTitle: string;
  methodologyLinks: string;
  methodologyPanelBody: string;
  methodologyPanelTitle: string;
  openLiveTerminal: string;
  readBrief: string;
  readMethodology: string;
  readSourceNote: string;
  settlementSource: string;
  shareOnX: string;
  snapshot: string;
  sourceIndexDescription: string;
  sourceIndexEyebrow: string;
  sourceIndexTitle: string;
  sourceLinks: string;
  sourceNotes: string;
  sourcePanelBody: string;
  sourcePanelTitle: string;
  sources: string;
  updated: string;
  detailLabels: {
    debRead: string;
    modelContext: string;
    riskNotes: string;
    settlementSourceRead: string;
  };
};

export const PUBLIC_CONTENT_COPY: Record<LandingLocale, PublicContentCopy> = {
  "zh-CN": {
    allPublicBriefs: "全部公开简报",
    briefIndexDescription:
      "公开天气市场简报把选定城市的市场读数整理为可索引证据：结算源、DEB 背景、模型分歧、新鲜度备注，以及明确的研究免责声明。",
    briefIndexEyebrow: "天气市场简报",
    briefIndexTitle: "公开天气市场简报",
    checksBeforeActing: "行动前检查",
    distributionCopy: "分发文案",
    docs: "文档",
    freshness: "新鲜度",
    market: "市场",
    methodology: "方法",
    methodologyIndexDescription:
      "公开方法页解释 PolyWeather 如何处理 DEB 融合、结算源优先级、新鲜度和来源校验。",
    methodologyIndexEyebrow: "方法",
    methodologyIndexTitle: "PolyWeather 如何读取天气市场",
    methodologyLinks: "方法链接",
    methodologyPanelBody:
      "简报会交叉链接 DEB 方法和结算源优先级页面，让读者能审计为什么 PolyWeather 不把通用城市预报直接当作市场真实值。",
    methodologyPanelTitle: "公开读数如何产生",
    openLiveTerminal: "打开实时终端",
    readBrief: "阅读简报",
    readMethodology: "阅读方法",
    readSourceNote: "阅读来源说明",
    settlementSource: "结算源",
    shareOnX: "分享到 X",
    snapshot: "快照",
    sourceIndexDescription:
      "来源页把官方观测、机场观测和模型指引分开展示，方便读者审计 PolyWeather 为什么优先使用与结算相关的证据。",
    sourceIndexEyebrow: "来源",
    sourceIndexTitle: "用于公开审计的天气来源说明",
    sourceLinks: "来源链接",
    sourceNotes: "来源说明",
    sourcePanelBody:
      "来源页解释为什么 MGM、METAR、HKO、NOAA 和模型指引会在 PolyWeather 工作流中分开展示。",
    sourcePanelTitle: "官方来源上下文",
    sources: "来源",
    updated: "更新",
    detailLabels: {
      debRead: "DEB 读数",
      modelContext: "模型上下文",
      riskNotes: "风险备注",
      settlementSourceRead: "结算源读数",
    },
  },
  "en-US": {
    allPublicBriefs: "All public briefs",
    briefIndexDescription:
      "Public Weather Market Brief pages turn selected city-market reads into indexable evidence: settlement source, DEB context, model disagreement, freshness notes, and a clear research disclaimer.",
    briefIndexEyebrow: "Weather Market Brief",
    briefIndexTitle: "Public market briefs for temperature judgment",
    checksBeforeActing: "Checks before acting",
    distributionCopy: "Distribution copy",
    docs: "Docs",
    freshness: "Freshness",
    market: "Market",
    methodology: "Methodology",
    methodologyIndexDescription:
      "Public methodology pages explain how PolyWeather handles DEB blending, settlement-source priority, freshness, and source reconciliation for prediction-market weather analysis.",
    methodologyIndexEyebrow: "Methodology",
    methodologyIndexTitle: "How PolyWeather reads weather markets",
    methodologyLinks: "Methodology links",
    methodologyPanelBody:
      "Briefs cross-link to the DEB methodology and settlement-source priority pages so readers can audit why PolyWeather does not treat generic city forecasts as market truth.",
    methodologyPanelTitle: "How the public read is produced",
    openLiveTerminal: "Open live terminal",
    readBrief: "Read brief",
    readMethodology: "Read methodology",
    readSourceNote: "Read source note",
    settlementSource: "Settlement source",
    shareOnX: "Share on X",
    snapshot: "Snapshot",
    sourceIndexDescription:
      "Source pages separate official observations, airport observations, and model guidance so readers can inspect why PolyWeather prioritizes settlement-relevant evidence.",
    sourceIndexEyebrow: "Sources",
    sourceIndexTitle: "Weather source notes for public audit",
    sourceLinks: "Source links",
    sourceNotes: "Source notes",
    sourcePanelBody:
      "Source pages explain why MGM, METAR, HKO, NOAA, and model guidance are displayed separately in PolyWeather workflows.",
    sourcePanelTitle: "Official-source context",
    sources: "Sources",
    updated: "Updated",
    detailLabels: {
      debRead: "DEB read",
      modelContext: "Model context",
      riskNotes: "Risk notes",
      settlementSourceRead: "Settlement-source read",
    },
  },
};

export const PUBLIC_BRIEFS: PublicBrief[] = [
  {
    city: "ankara",
    cityName: "Ankara",
    countryName: "Turkey",
    date: "2026-06-24",
    title: "Ankara Weather Market Brief - 24 Jun 2026",
    description:
      "A public market brief for Ankara maximum temperature judgment, focused on MGM settlement-source behavior, DEB blended forecast context, and anomaly checks.",
    market: "Same-day maximum temperature judgment",
    settlementSource: "MGM official station",
    updatedAt: "2026-06-24T13:55:00+03:00",
    publishedAt: "2026-06-24T13:55:00+03:00",
    dataFreshness:
      "Static public snapshot. Paid terminal users should verify the latest official observation and SSE replay state before acting.",
    debRead:
      "DEB kept the intraday high-temperature read below the isolated MGM spike and closer to the observed official range.",
    sourceRead:
      "MGM is treated as the primary settlement reference. A single 27.1°C point should be checked against adjacent official readings before it is accepted as a new high.",
    modelRead:
      "ECMWF was warmer than the DEB blend in the early afternoon window, but the public brief weights official observations above model-only movement.",
    riskRead:
      "Main risk is a late official update or a source-side correction that changes the recognized high after the public snapshot.",
    notFinancialAdvice:
      "This brief is weather-research content for prediction-market preparation. It is not financial advice and does not guarantee settlement outcomes.",
    distributionText:
      "Ankara 2026-06-24 public Weather Market Brief: MGM official readings favored a 24.5°C observed high over an isolated 27.1°C spike; DEB stayed below the outlier. Not financial advice.",
    primaryCtaLabel: "Open live terminal",
    sourceSlugs: ["mgm", "metar", "ecmwf"],
    methodologySlugs: ["deb", "settlement-sources"],
    signals: [
      {
        label: "Observed high so far",
        value: "24.5°C",
        detail: "Official-source value to compare against any isolated higher point.",
      },
      {
        label: "Outlier under review",
        value: "27.1°C",
        detail: "A sudden single-source value needs neighboring-time validation.",
      },
      {
        label: "DEB public read",
        value: "Below spike",
        detail: "Blend stayed closer to the verified observation band.",
      },
    ],
    checkpoints: [
      "Check whether the suspected spike appears in the official high-temperature summary.",
      "Compare adjacent MGM observations before treating a single point as settlement-relevant.",
      "Review the paid terminal for live chart patches and source freshness before market close.",
    ],
  },
  {
    city: "hong-kong",
    cityName: "Hong Kong",
    countryName: "Hong Kong",
    date: "2026-06-24",
    title: "Hong Kong Weather Market Brief - 24 Jun 2026",
    description:
      "A public brief showing how PolyWeather frames HKO/Cheung Chau/airport observations against DEB and model spread for maximum-temperature markets.",
    market: "Urban and airport maximum temperature judgment",
    settlementSource: "HKO official network",
    updatedAt: "2026-06-24T18:00:00+08:00",
    publishedAt: "2026-06-24T18:00:00+08:00",
    dataFreshness:
      "Static public snapshot. Live terminal values may differ as HKO and station caches refresh.",
    debRead:
      "DEB favored a narrow high-temperature window because live observations and model spread were aligned by late afternoon.",
    sourceRead:
      "HKO network observations remain the source family to reconcile before interpreting airport-only movement.",
    modelRead:
      "Model disagreement was limited, so source freshness and station selection mattered more than broad synoptic uncertainty.",
    riskRead:
      "Primary risk is station-specific heat retention during late afternoon or a late official summary revision.",
    notFinancialAdvice:
      "This brief is weather-research content for prediction-market preparation. It is not financial advice and does not guarantee settlement outcomes.",
    distributionText:
      "Hong Kong 2026-06-24 public Weather Market Brief: source selection and HKO freshness mattered more than model spread. Not financial advice.",
    primaryCtaLabel: "Open live terminal",
    sourceSlugs: ["hko", "metar"],
    methodologySlugs: ["deb", "settlement-sources"],
    signals: [
      {
        label: "Source family",
        value: "HKO",
        detail: "Use official station context before airport-only interpretation.",
      },
      {
        label: "Model spread",
        value: "Low",
        detail: "Late-day uncertainty mainly came from station behavior.",
      },
      {
        label: "Terminal need",
        value: "Freshness",
        detail: "Live source timestamps decide whether the public snapshot is still useful.",
      },
    ],
    checkpoints: [
      "Verify HKO station timestamps before comparing market bands.",
      "Separate airport METAR observations from settlement-source network readings.",
      "Check terminal source health if the public snapshot is older than one refresh cycle.",
    ],
  },
  {
    city: "new-york",
    cityName: "New York",
    countryName: "United States",
    date: "2026-06-24",
    title: "New York Weather Market Brief - 24 Jun 2026",
    description:
      "A public brief for New York temperature markets, connecting METAR, NOAA context, DEB blending, and late-day risk checks.",
    market: "Airport-linked maximum temperature judgment",
    settlementSource: "METAR and NOAA station context",
    updatedAt: "2026-06-24T12:30:00-04:00",
    publishedAt: "2026-06-24T12:30:00-04:00",
    dataFreshness:
      "Static public snapshot. Paid terminal users should check current METAR observations and official summaries.",
    debRead:
      "DEB weighted the latest observation trend against warmer model guidance instead of following the raw model high.",
    sourceRead:
      "METAR provides fast airport evidence, while NOAA context helps validate whether the airport value is representative.",
    modelRead:
      "Warm model guidance can be useful only after it is reconciled with live airport observations and cloud/wind context.",
    riskRead:
      "Primary risk is a short late-day break in cloud cover that lifts airport observations into a higher band.",
    notFinancialAdvice:
      "This brief is weather-research content for prediction-market preparation. It is not financial advice and does not guarantee settlement outcomes.",
    distributionText:
      "New York 2026-06-24 public Weather Market Brief: DEB blended warmer guidance against live airport evidence. Not financial advice.",
    primaryCtaLabel: "Open live terminal",
    sourceSlugs: ["metar", "noaa"],
    methodologySlugs: ["deb", "settlement-sources"],
    signals: [
      {
        label: "Fast evidence",
        value: "METAR",
        detail: "Airport observations define the short-cycle read.",
      },
      {
        label: "Validation",
        value: "NOAA",
        detail: "Official context helps audit the final high-temperature interpretation.",
      },
      {
        label: "DEB stance",
        value: "Blend",
        detail: "Do not follow a warm model run without live evidence confirmation.",
      },
    ],
    checkpoints: [
      "Watch the last two METAR cycles before the daily high window ends.",
      "Check whether model warmth is supported by cloud and wind observations.",
      "Use official source context before final settlement interpretation.",
    ],
  },
];

export const METHODOLOGY_PAGES: MethodologyPage[] = [
  {
    slug: "deb",
    title: "DEB Forecast Methodology",
    description:
      "How PolyWeather frames DEB blended forecasts for prediction-market temperature decisions without replacing settlement-source evidence.",
    updatedAt: "2026-06-24T00:00:00Z",
    summary:
      "DEB is the public name for PolyWeather's blended forecast layer. It reconciles model guidance, live observation momentum, source freshness, and station context so users can judge a high-temperature band with fewer single-model mistakes.",
    sections: [
      {
        heading: "What DEB is for",
        body:
          "DEB is not a settlement oracle. It is a decision-support layer that makes the live observation path and model spread easier to compare.",
        bullets: [
          "Prefer settlement-source evidence when it conflicts with model-only guidance.",
          "Treat stale or isolated source values as quality-control candidates.",
          "Expose the forecast band and the reason a band is widening or narrowing.",
        ],
      },
      {
        heading: "Inputs that matter",
        body:
          "The blend is useful because it combines different evidence classes instead of pretending one model run is enough.",
        bullets: [
          "Latest official or airport observations and their freshness.",
          "Model consensus and disagreement across ECMWF, GFS, ICON, GEM, and local sources when available.",
          "City-specific source behavior, station selection, and intraday high timing.",
        ],
      },
      {
        heading: "How to read a DEB miss",
        body:
          "A DEB miss should be reviewed by separating source freshness, model spread, and settlement-source revisions.",
        bullets: [
          "If the observed high changed after a late source patch, classify it as a freshness or replay issue.",
          "If every source was fresh but the high landed outside the band, review model weighting and local station features.",
          "If one source jumped alone, audit neighboring observations before retraining around the outlier.",
        ],
      },
    ],
  },
  {
    slug: "settlement-sources",
    title: "Settlement-Source Priority",
    description:
      "Why PolyWeather presents official settlement-related observations before generic weather API values.",
    updatedAt: "2026-06-24T00:00:00Z",
    summary:
      "Prediction-market users care about the number that resolves the contract. PolyWeather therefore puts official station, airport, and operator-specific source behavior above broad consumer-weather averages.",
    sections: [
      {
        heading: "Why generic weather values are not enough",
        body:
          "Consumer weather apps often smooth station data or display city-wide approximations. Market resolution can depend on a narrower official source.",
        bullets: [
          "A city label may hide multiple stations with different daily highs.",
          "Airport METAR can update faster than a public summary, but may not be the final settlement source.",
          "Official source revisions can matter more than a visually smooth forecast curve.",
        ],
      },
      {
        heading: "What PolyWeather surfaces",
        body:
          "The terminal separates source labels, observation timestamps, forecast models, and freshness state so a user can audit the path to a number.",
        bullets: [
          "Settlement-source labels and station context on charts.",
          "Source freshness, cache policy, and SSE patch visibility.",
          "DEB forecast context shown next to live observations, not as a replacement for them.",
        ],
      },
    ],
  },
];

export const SOURCE_PAGES: SourcePage[] = [
  {
    slug: "mgm",
    title: "MGM Weather Source",
    description:
      "PolyWeather source note for Turkish MGM observations used in Ankara-style temperature market analysis.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "Turkish State Meteorological Service",
    coverage: "Turkey official station network, including Ankara market context.",
    cadence: "Source cadence varies by station and publication path; terminal freshness checks are required.",
    settlementUse:
      "Used as the primary official-source family when Ankara markets reference Turkish official observations.",
    reliabilityNotes: [
      "Single-point spikes should be compared with neighboring timestamps before being accepted.",
      "Official summaries can lag raw point observations.",
      "Cache and SSE replay state should be checked when a value appears suddenly.",
    ],
    relatedMethodologySlugs: ["settlement-sources", "deb"],
  },
  {
    slug: "metar",
    title: "METAR Airport Observations",
    description:
      "PolyWeather source note for airport METAR observations used as fast evidence in temperature-market workflows.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "Airport weather observation network",
    coverage: "Airport-linked observations across supported markets.",
    cadence: "Often hourly or sub-hourly depending on airport and issuance behavior.",
    settlementUse:
      "Useful for fast evidence and airport-linked contracts; must be reconciled with the contract's exact settlement source.",
    reliabilityNotes: [
      "METAR can update faster than official daily summaries.",
      "Airport exposure may differ from city-center official stations.",
      "Late METAR cycles can change high-temperature judgment near market close.",
    ],
    relatedMethodologySlugs: ["settlement-sources", "deb"],
  },
  {
    slug: "ecmwf",
    title: "ECMWF Model Guidance",
    description:
      "PolyWeather source note for ECMWF model guidance as one input into DEB blended forecasts.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "European Centre for Medium-Range Weather Forecasts",
    coverage: "Global numerical weather prediction guidance.",
    cadence: "Model-run cadence depends on product and ingestion timing.",
    settlementUse:
      "Used for forecast context only. It does not replace live official observations for settlement interpretation.",
    reliabilityNotes: [
      "Model warmth or coolness should be validated against live observations.",
      "Run-to-run shifts can be useful when source evidence has not yet settled.",
      "Model spread should be shown beside, not above, settlement-source data.",
    ],
    relatedMethodologySlugs: ["deb"],
  },
  {
    slug: "hko",
    title: "HKO Official Observations",
    description:
      "PolyWeather source note for Hong Kong Observatory observations in Hong Kong market analysis.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "Hong Kong Observatory",
    coverage: "Hong Kong official observation network and station-specific context.",
    cadence: "Cadence varies by observation product; terminal freshness checks remain required.",
    settlementUse:
      "Used as the official-source family for Hong Kong station and city-market interpretation.",
    reliabilityNotes: [
      "Station selection can materially change the maximum-temperature read.",
      "Airport observations should be separated from broader HKO network readings.",
      "Humidity, wind, and late-day sun breaks can affect final highs.",
    ],
    relatedMethodologySlugs: ["settlement-sources", "deb"],
  },
  {
    slug: "noaa",
    title: "NOAA Weather Context",
    description:
      "PolyWeather source note for NOAA context used to validate US weather-market observations and summaries.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "National Oceanic and Atmospheric Administration",
    coverage: "United States official weather observations, summaries, and context products.",
    cadence: "Cadence depends on product family and station reporting behavior.",
    settlementUse:
      "Used to audit and contextualize US official observations where contract rules reference NOAA/NWS data.",
    reliabilityNotes: [
      "Official summaries can arrive after fast airport observations.",
      "Daily high interpretation should match the contract's station and time zone rules.",
      "Use NOAA context to confirm whether an airport observation is representative.",
    ],
    relatedMethodologySlugs: ["settlement-sources", "deb"],
  },
];

const BRIEF_LOCALIZATIONS: Record<string, Partial<PublicBrief>> = {
  "ankara:2026-06-24": {
    cityName: "安卡拉",
    countryName: "土耳其",
    title: "安卡拉天气市场简报 - 2026年6月24日",
    description:
      "安卡拉最高温公开简报，聚焦 MGM 结算源行为、DEB 融合预报背景和异常值复核。",
    market: "当日最高温判断",
    settlementSource: "MGM 官方站",
    dataFreshness:
      "静态公开快照。付费终端用户行动前应核对最新官方观测和 SSE replay 状态。",
    debRead:
      "DEB 将日内最高温读数压在孤立 MGM 尖峰下方，更接近已观测的官方区间。",
    sourceRead:
      "MGM 被视为主要结算参考。单个 27.1°C 点位在接受为新高前，需要与相邻官方读数比对。",
    modelRead:
      "ECMWF 在午后窗口比 DEB 融合更暖，但公开简报把官方观测置于纯模型移动之上。",
    riskRead:
      "主要风险是晚些时候官方更新或来源侧修正，导致公开快照后的认可高温发生变化。",
    notFinancialAdvice:
      "本简报是用于预测市场准备的天气研究内容，不构成金融建议，也不保证结算结果。",
    distributionText:
      "安卡拉 2026-06-24 公开天气市场简报：MGM 官方读数更支持 24.5°C 已观测高温，而非孤立 27.1°C 尖峰；DEB 仍低于异常点。非金融建议。",
    primaryCtaLabel: "打开实时终端",
    signals: [
      {
        label: "目前官方高温",
        value: "24.5°C",
        detail: "用于对比任何孤立更高点的官方来源值。",
      },
      {
        label: "异常点待复核",
        value: "27.1°C",
        detail: "突然出现的单源值需要相邻时间验证。",
      },
      {
        label: "DEB 公开读数",
        value: "低于尖峰",
        detail: "融合路径仍更接近已验证观测带。",
      },
    ],
    checkpoints: [
      "检查疑似尖峰是否进入官方高温摘要。",
      "在把单点视为结算相关之前，先比较相邻 MGM 观测。",
      "市场关闭前查看付费终端的实时图表 patch 和来源新鲜度。",
    ],
  },
  "hong-kong:2026-06-24": {
    cityName: "香港",
    countryName: "香港",
    title: "香港天气市场简报 - 2026年6月24日",
    description:
      "公开简报展示 PolyWeather 如何把 HKO/长洲/机场观测与 DEB、模型分歧放在一起解释最高温市场。",
    market: "城市与机场最高温判断",
    settlementSource: "HKO 官方网络",
    dataFreshness:
      "静态公开快照。HKO 和站点缓存刷新后，实时终端数值可能不同。",
    debRead:
      "到午后后段，实况观测与模型分歧趋于一致，DEB 支持较窄的高温窗口。",
    sourceRead:
      "解释机场单独移动前，应先把 HKO 网络观测作为需要校验的来源族。",
    modelRead:
      "模型分歧有限，因此来源新鲜度和站点选择比大尺度天气不确定性更重要。",
    riskRead:
      "主要风险是午后后段特定站点保温，或官方摘要出现较晚修订。",
    notFinancialAdvice:
      "本简报是用于预测市场准备的天气研究内容，不构成金融建议，也不保证结算结果。",
    distributionText:
      "香港 2026-06-24 公开天气市场简报：来源选择和 HKO 新鲜度比模型分歧更关键。非金融建议。",
    primaryCtaLabel: "打开实时终端",
    signals: [
      {
        label: "来源族",
        value: "HKO",
        detail: "先使用官方站上下文，再解释机场读数。",
      },
      {
        label: "模型分歧",
        value: "低",
        detail: "晚间不确定性主要来自站点行为。",
      },
      {
        label: "终端需要",
        value: "新鲜度",
        detail: "实时来源时间戳决定公开快照是否仍有用。",
      },
    ],
    checkpoints: [
      "比较市场温度桶前先确认 HKO 站点时间戳。",
      "把机场 METAR 观测与 HKO 网络读数分开解释。",
      "如果公开快照已超过一个刷新周期，检查终端来源健康状态。",
    ],
  },
  "new-york:2026-06-24": {
    cityName: "纽约",
    countryName: "美国",
    title: "纽约天气市场简报 - 2026年6月24日",
    description:
      "纽约温度市场公开简报，连接 METAR、NOAA 上下文、DEB 融合和日内尾段风险检查。",
    market: "机场关联最高温判断",
    settlementSource: "METAR 与 NOAA 站点上下文",
    dataFreshness:
      "静态公开快照。付费终端用户应检查当前 METAR 观测和官方摘要。",
    debRead:
      "DEB 用最新观测趋势校验偏暖模型指引，而不是直接追随原始模型高温。",
    sourceRead:
      "METAR 提供快速机场证据，NOAA 上下文帮助确认机场读数是否具代表性。",
    modelRead:
      "偏暖模型指引只有在和机场实况、云量/风场上下文校验后才有价值。",
    riskRead:
      "主要风险是日内尾段云层短暂打开，将机场观测推入更高温度桶。",
    notFinancialAdvice:
      "本简报是用于预测市场准备的天气研究内容，不构成金融建议，也不保证结算结果。",
    distributionText:
      "纽约 2026-06-24 公开天气市场简报：DEB 将偏暖模型指引与机场实时证据融合。非金融建议。",
    primaryCtaLabel: "打开实时终端",
    signals: [
      {
        label: "快速证据",
        value: "METAR",
        detail: "机场观测定义短周期读数。",
      },
      {
        label: "复核",
        value: "NOAA",
        detail: "官方上下文帮助审计最终最高温解释。",
      },
      {
        label: "DEB 立场",
        value: "融合",
        detail: "没有实况确认，不追随偏暖模型运行。",
      },
    ],
    checkpoints: [
      "在每日高温窗口结束前观察最后两个 METAR 周期。",
      "检查模型偏暖是否得到云量和风场观测支持。",
      "最终解释结算前先使用官方来源上下文。",
    ],
  },
};

const METHODOLOGY_TITLE_LOCALIZATIONS: Record<string, string> = {
  deb: "DEB 预测方法",
  "settlement-sources": "结算源优先级",
};

const SOURCE_TITLE_LOCALIZATIONS: Record<string, string> = {
  ecmwf: "ECMWF 模型指引",
  hko: "HKO 官方观测",
  metar: "METAR 机场观测",
  mgm: "MGM 天气来源",
  noaa: "NOAA 天气上下文",
};

export function localizeBrief(brief: PublicBrief, locale: LandingLocale): PublicBrief {
  if (locale === "en-US") return brief;
  const localized = BRIEF_LOCALIZATIONS[`${brief.city}:${brief.date}`] || {};
  return {
    ...brief,
    ...localized,
    checkpoints: localized.checkpoints || brief.checkpoints,
    methodologySlugs: localized.methodologySlugs || brief.methodologySlugs,
    signals: localized.signals || brief.signals,
    sourceSlugs: localized.sourceSlugs || brief.sourceSlugs,
  };
}

export function localizeBriefs(locale: LandingLocale) {
  return PUBLIC_BRIEFS.map((brief) => localizeBrief(brief, locale));
}

export function localizeMethodologyPage(page: MethodologyPage, locale: LandingLocale): MethodologyPage {
  if (locale === "en-US") return page;
  return {
    ...page,
    title: METHODOLOGY_TITLE_LOCALIZATIONS[page.slug] || page.title,
  };
}

export function localizeSourcePage(page: SourcePage, locale: LandingLocale): SourcePage {
  if (locale === "en-US") return page;
  return {
    ...page,
    title: SOURCE_TITLE_LOCALIZATIONS[page.slug] || page.title,
  };
}

export function briefPath(brief: PublicBrief) {
  return `/briefs/${brief.city}/${brief.date}`;
}

export function methodologyPath(page: MethodologyPage) {
  return `/methodology/${page.slug}`;
}

export function sourcePath(page: SourcePage) {
  return `/sources/${page.slug}`;
}

export function getBrief(city: string, date: string) {
  return PUBLIC_BRIEFS.find((brief) => brief.city === city && brief.date === date);
}

export function getMethodologyPage(slug: string) {
  return METHODOLOGY_PAGES.find((page) => page.slug === slug);
}

export function getSourcePage(slug: string) {
  return SOURCE_PAGES.find((page) => page.slug === slug);
}

export function absolutePublicUrl(pathname: string) {
  return `${PUBLIC_CONTENT_BASE_URL}${pathname}`;
}
