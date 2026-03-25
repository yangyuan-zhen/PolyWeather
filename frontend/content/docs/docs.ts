export type DocsLocale = "zh-CN" | "en-US";

export type DocsBlock =
  | { type: "paragraph"; text: string }
  | { type: "callout"; tone?: "info" | "warning" | "success"; title?: string; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "link"; href: string; label: string; caption?: string }
  | { type: "image"; src: string; alt: string; caption?: string };

export interface DocsSection {
  id: string;
  title: string;
  blocks: DocsBlock[];
}

export interface DocsPageContent {
  title: string;
  description: string;
  sections: DocsSection[];
}

export interface DocsPageMeta {
  slug: string;
  group: "getting-started" | "analysis" | "settlement" | "history";
}

export interface DocsPage extends DocsPageMeta {
  content: Record<DocsLocale, DocsPageContent>;
}

export interface DocsNavGroup {
  id: DocsPageMeta["group"];
  title: Record<DocsLocale, string>;
}

export const DOCS_PAGES: DocsPage[] = [
  {
    slug: "intro",
    group: "getting-started",
    content: {
      "zh-CN": {
        title: "简介",
        description: "PolyWeather 文档中心解释核心产品概念、结算口径和日内结构信号，帮助用户把天气分析转成可执行判断。",
        sections: [
          {
            id: "what-is-polyweather",
            title: "PolyWeather 是什么",
            blocks: [
              { type: "paragraph", text: "PolyWeather 不是通用天气 App。它面向天气衍生品和温度市场，重点回答三个问题：今天最高温大概会落在哪个区间、机场或官方结算站会不会被压温、市场有没有明显错定价。" },
              { type: "callout", tone: "info", title: "产品定位", text: "主站的核心价值不是报天气，而是把模型、实况、机场预报和结算规则整合成交易可用的信息。" },
            ],
          },
          {
            id: "core-modules",
            title: "你会在页面上看到什么",
            blocks: [
              { type: "bullets", items: ["今日日内分析：围绕今日峰值窗口，解释近地面信号、高空结构和机场 TAF。", "多模型预报：展示 DEB 与多模型最高温预测，帮助判断市场当前最热桶是否合理。", "历史对账：查看近 15 天已结算样本、DEB MAE 与最佳单模型表现。", "机场报文解读：把 METAR / TAF 缩写翻成普通用户能理解的话。"] },
            ],
          },
          {
            id: "how-to-read",
            title: "如何快速读懂主站",
            blocks: [
              { type: "steps", items: ["先看今日气温预测图，确认当前实测、DEB 预测和峰值窗口。", "再看今日日内结构信号，判断现在是偏支持继续升温、偏压制，还是先观察。", "最后看市场对照与概率分布，判断市场是否已经把天气结构计入价格。"] },
            ],
          },
        ],
      },
      "en-US": {
        title: "Introduction",
        description: "The PolyWeather docs explain the product's core concepts, settlement logic, and intraday structural signals so users can turn weather context into actionable decisions.",
        sections: [
          {
            id: "what-is-polyweather",
            title: "What PolyWeather is",
            blocks: [
              { type: "paragraph", text: "PolyWeather is not a generic weather app. It is built for weather derivatives and temperature markets, with one job: estimate the likely high-temperature bucket, explain whether the airport or official settlement site may get capped, and surface whether the market is mispricing that outcome." },
              { type: "callout", tone: "info", title: "Product focus", text: "The core value is not raw weather reporting. It is the conversion of models, observations, airport forecasts, and settlement rules into usable trading context." },
            ],
          },
          {
            id: "core-modules",
            title: "What you see on the site",
            blocks: [
              { type: "bullets", items: ["Intraday analysis: peak-window focused reading of surface structure, upper-air structure, and airport TAF.", "Multi-model forecast: DEB versus major model highs, useful for checking whether the hottest market bucket is justified.", "History reconciliation: settled-sample MAE and hit-rate over the last 15 days.", "Airport narrative: plain-language translation of METAR / TAF shorthand."] },
            ],
          },
          {
            id: "how-to-read",
            title: "How to read the dashboard quickly",
            blocks: [
              { type: "steps", items: ["Start with the intraday temperature chart to anchor current observations, DEB, and the expected peak window.", "Read the structural signal next to see whether the setup still supports further warming, leans suppressive, or remains mixed.", "Then compare that weather structure against market buckets and settlement probabilities."] },
            ],
          },
        ],
      },
    },
  },
  {
    slug: "intraday-signal",
    group: "analysis",
    content: {
      "zh-CN": {
        title: "今日日内结构信号",
        description: "这页解释顶部“今日日内结构信号”如何生成，以及近地面与机场 TAF 为什么会同时出现。",
        sections: [
          {
            id: "surface-vs-upper",
            title: "近地面信号和高空结构信号的区别",
            blocks: [
              { type: "paragraph", text: "近地面信号主要来自小时级温度、露点、气压、风向、降水概率和云量变化。它回答的是：在当前到峰值窗口这几个小时里，地面结构更支持继续升温，还是更容易被压住。" },
              { type: "paragraph", text: "高空结构信号主要来自高空派生字段、机场 TAF 与市场侧信息的综合判断。它回答的是：峰值窗口附近，高空和机场侧有没有新的扰动把最高温封顶。" },
            ],
          },
          {
            id: "peak-window",
            title: "为什么总在讲峰值窗口",
            blocks: [
              { type: "paragraph", text: "PolyWeather 不按固定下午时段做判断，而是尽量围绕当天预计最高温兑现的窗口来分析。这样不同城市的峰值时间差异才不会被硬套成同一套模板。" },
              { type: "callout", tone: "success", title: "窗口感知", text: "页面里的“今日 12:00-16:00（约 5 小时，围绕峰值窗口）”就是在提示当前结构判断真正关注的时段。" },
            ],
          },
          {
            id: "trade-language",
            title: "交易语言怎么读",
            blocks: [
              { type: "bullets", items: ["偏支持：结构仍支持继续升温，别太早押高温见顶。", "偏压制：高温继续上冲的把握不大，别盲目追热。", "先观察：现在还看不出明确方向，先等下一步走势确认。"] },
            ],
          },
        ],
      },
      "en-US": {
        title: "Intraday Structural Signal",
        description: "This page explains how the intraday structural signal is built and why surface structure and airport TAF both appear in the same reading.",
        sections: [
          {
            id: "surface-vs-upper",
            title: "Surface versus upper-air structure",
            blocks: [
              { type: "paragraph", text: "The surface layer comes from hourly temperature, dew point, pressure, wind, precipitation probability, and cloud-cover changes. It answers a near-term question: between now and the peak window, does the local surface setup still support more warming or does it look easier to cap?" },
              { type: "paragraph", text: "The upper-air layer combines derived profile signals, airport TAF, and market-side context. It answers a different question: around the peak window, is there a new airport-side or upper-air disturbance that could lock the high in place?" },
            ],
          },
          {
            id: "peak-window",
            title: "Why everything is framed around the peak window",
            blocks: [
              { type: "paragraph", text: "PolyWeather does not force every city into the same afternoon template. It centers the analysis on the expected high-temperature payoff window for that city on that day, so different cities are not interpreted through the wrong hours." },
              { type: "callout", tone: "success", title: "Window-aware reading", text: "When you see a line such as “12:00-16:00 (~5h, around the peak window)”, that is the actual window driving the current structural read." },
            ],
          },
          {
            id: "trade-language",
            title: "How to read the trading language",
            blocks: [
              { type: "bullets", items: ["Supportive: the setup still supports more warming. Do not call the high too early.", "Suppressive: further upside looks less reliable. Do not chase the high blindly.", "Wait / confirm: the setup is still mixed. Let the next move decide first."] },
            ],
          },
        ],
      },
    },
  },
  {
    slug: "taf-signal",
    group: "analysis",
    content: {
      "zh-CN": {
        title: "TAF 信号",
        description: "TAF 不是结算温度，但它能告诉你机场侧在峰值窗口前后会不会有云雨、雷暴或风向切换，把最高温压住。",
        sections: [
          {
            id: "what-taf-does",
            title: "TAF 在 PolyWeather 里负责什么",
            blocks: [
              { type: "paragraph", text: "TAF 在项目里是机场侧确认层，而不是温度主预测曲线。它主要补三类信息：峰值窗口有没有云雨压温、午后扰动是不是正在增强、机场风向是否发生阶段性切换。" },
            ],
          },
          {
            id: "taf-periods",
            title: "图上的 TAF 时段是什么意思",
            blocks: [
              { type: "bullets", items: ["基础时段（BASE）：TAF 的默认主背景天气。", "明确切换（FM）：从某个时刻开始，机场预报切换到一套新天气状态。", "临时波动（TEMPO）：一段时间内可能临时出现扰动，但不代表主背景永久改变。", "逐步转变（BECMG）：天气不是一下子切，而是在一段时间里渐变。", "30% / 40% 风险窗（PROB30/40）：风险有概率出现，不代表一定发生。"] },
            ],
          },
          {
            id: "airport-suppression",
            title: "什么叫机场端压温风险偏高",
            blocks: [
              { type: "paragraph", text: "它的意思不是整座城市一定更冷，而是作为结算依据的机场站点，在峰值窗口里更可能因为云、阵雨或雷暴扰动，冲不到本来可能达到的更高温度。" },
              { type: "callout", tone: "warning", title: "重点区别", text: "TAF 负责告诉你机场侧未来几个小时会不会出现压温扰动，不直接等于结算温度本身。结算仍然看 METAR、HKO、MGM、NOAA RCTP 等实际结算源。" },
            ],
          },
        ],
      },
      "en-US": {
        title: "TAF Signal",
        description: "TAF is not the settlement temperature itself, but it is useful for telling you whether the airport side may see clouds, showers, thunderstorms, or wind shifts that cap the high around the payoff window.",
        sections: [
          {
            id: "what-taf-does",
            title: "What TAF does inside PolyWeather",
            blocks: [
              { type: "paragraph", text: "Within the product, TAF acts as an airport-side confirmation layer rather than the main temperature curve. Its job is to tell you whether clouds/rain may suppress the airport high, whether afternoon disruption is building, and whether the airport wind regime is about to shift in stages." },
            ],
          },
          {
            id: "taf-periods",
            title: "What the TAF timing labels mean",
            blocks: [
              { type: "bullets", items: ["Base regime: the default background forecast segment.", "Hard shift (FM): a new weather regime begins from an explicit time.", "Temporary swing (TEMPO): a temporary disturbance window that does not replace the background regime permanently.", "Gradual shift (BECMG): conditions transition across a window instead of flipping instantly.", "30% / 40% risk window (PROB30/40): a probabilistic risk window, not a certainty signal."] },
            ],
          },
          {
            id: "airport-suppression",
            title: "What airport-side suppression risk means",
            blocks: [
              { type: "paragraph", text: "It does not mean the entire city must run cooler. It means the airport station used for settlement is more likely to get capped by clouds, showers, or thunderstorm disruption during the peak window and fail to reach the next warmer bucket." },
              { type: "callout", tone: "warning", title: "Important distinction", text: "TAF explains whether the airport side may face suppressive weather over the next few hours. Settlement still comes from the actual settlement source such as METAR, HKO, MGM, or NOAA RCTP." },
            ],
          },
        ],
      },
    },
  },
  {
    slug: "settlement-sources",
    group: "settlement",
    content: {
      "zh-CN": {
        title: "结算来源说明",
        description: "不同城市的结算口径不同。理解结算源，比单纯看模型曲线更重要。",
        sections: [
          {
            id: "why-settlement-matters",
            title: "为什么先看结算源",
            blocks: [
              { type: "paragraph", text: "同样是“城市最高温”，市场真正结算看的往往不是城区平均温度，而是规则指定的机场或官方站点。交易上最常见的错觉，是把城市体感温度当成结算温度。" },
            ],
          },
          {
            id: "city-rules",
            title: "当前主要口径",
            blocks: [
              { type: "bullets", items: ["多数欧美机场市场：按机场 METAR 或机场主站实况结算。", "香港：按香港天文台 HKO 主口径，不接机场 TAF 作为主结算逻辑。", "台北：按 NOAA RCTP（台湾桃园国际机场）最终完成质控后的最高整度摄氏值结算，机场观测和市区体感不可混用。", "Ankara：结算主站以 LTAC / Esenboğa 为准，同时保留 Turkish MGM 作为领先结构参考。"] },
            ],
          },
          {
            id: "common-mistakes",
            title: "最常见的误解",
            blocks: [
              { type: "bullets", items: ["TAF 不是结算源，它只告诉你机场未来有没有压温扰动。", "市场按机场结算时，城区更热不代表市场就该结到更高温桶。", "香港和台北不能简单套用机场 TAF / METAR 主链逻辑。"] },
            ],
          },
        ],
      },
      "en-US": {
        title: "Settlement Sources",
        description: "Settlement rules differ by city. Understanding the settlement source matters more than staring only at model curves.",
        sections: [
          {
            id: "why-settlement-matters",
            title: "Why settlement source comes first",
            blocks: [
              { type: "paragraph", text: "A market may say “city high”, but the true settlement often comes from a designated airport or official site rather than the broader urban feel. One of the most common mistakes is to trade the city feel instead of the actual settlement station." },
            ],
          },
          {
            id: "city-rules",
            title: "Current primary rules",
            blocks: [
              { type: "bullets", items: ["Most airport-linked Western markets: settle on airport METAR or the airport primary observing site.", "Hong Kong: settles on HKO, not on airport TAF as the main settlement logic.", "Taipei: settles against NOAA RCTP using the finalized highest rounded whole-degree Celsius reading; airport observations and downtown feel should not be mixed.", "Ankara: settlement centers on LTAC / Esenboğa, with Turkish MGM retained as a leading-structure reference."] },
            ],
          },
          {
            id: "common-mistakes",
            title: "Common mistakes",
            blocks: [
              { type: "bullets", items: ["TAF is not a settlement source. It only tells you whether airport-side suppressive weather may appear.", "If the market settles on an airport site, a hotter downtown feel does not automatically justify a warmer settlement bucket.", "Hong Kong and Taipei should not be forced into the generic airport TAF / METAR chain."] },
            ],
          },
        ],
      },
    },
  },
  {
    slug: "history-reconciliation",
    group: "history",
    content: {
      "zh-CN": {
        title: "历史对账",
        description: "历史对账用于看已结算样本，不用于把当天未结算的行情硬算进胜率。",
        sections: [
          {
            id: "settled-only",
            title: "为什么只看已结算样本",
            blocks: [
              { type: "paragraph", text: "网页上的历史对账只统计已结算样本。当天还在交易中的市场，不会被提前算进 DEB 命中率或 MAE。这样做的目的，是避免用还没兑现的结果污染历史准确率。" },
            ],
          },
          {
            id: "rolling-window",
            title: "近 15 天滚动视图",
            blocks: [
              { type: "paragraph", text: "网页默认展示近 15 天滚动视图，方便比较最近这轮模型状态，而不是用过长的旧样本稀释当前表现。" },
            ],
          },
          {
            id: "peak-minus-12h",
            title: "峰值前 12 小时 DEB 参考",
            blocks: [
              { type: "paragraph", text: "这项指标用来回答一个更具体的问题：在真正出现高温之前 12 小时，DEB 当时大概有多准。它不是额外结算规则，而是一个用来观察模型是否过慢修正的参考视角。" },
              { type: "callout", tone: "info", title: "近似值说明", text: "当前峰值时间是根据历史快照链路反推的近似时间，不是逐分钟官方复盘。页面会明确标记为“参考 / 近似”。" },
            ],
          },
        ],
      },
      "en-US": {
        title: "History Reconciliation",
        description: "History reconciliation is for settled samples only. It is not meant to leak same-day unsettled outcomes into historical hit-rate or MAE.",
        sections: [
          {
            id: "settled-only",
            title: "Why only settled samples count",
            blocks: [
              { type: "paragraph", text: "The history panel only counts settled samples. Markets still trading on the same day are excluded from DEB hit-rate and MAE so unfinished outcomes do not contaminate the historical record." },
            ],
          },
          {
            id: "rolling-window",
            title: "Rolling 15-day view",
            blocks: [
              { type: "paragraph", text: "The web dashboard defaults to a rolling 15-day view so the panel reflects current model behavior rather than being overly diluted by older regimes." },
            ],
          },
          {
            id: "peak-minus-12h",
            title: "DEB at peak minus 12 hours",
            blocks: [
              { type: "paragraph", text: "This field answers a more specific question: how good was DEB roughly 12 hours before the eventual high actually printed? It is not a settlement rule, but a way to judge whether the model corrected too slowly." },
              { type: "callout", tone: "info", title: "Approximation note", text: "The current peak time is inferred from the snapshot chain and should be treated as an approximate reference rather than a minute-perfect official replay." },
            ],
          },
        ],
      },
    },
  },
  {
    slug: "extension",
    group: "getting-started",
    content: {
      "zh-CN": {
        title: "浏览器插件",
        description: "侧边栏插件是主站的轻量入口，负责监控、基础判断和导流，不承载完整分析链路。",
        sections: [
          {
            id: "extension-install",
            title: "安装地址",
            blocks: [
              {
                type: "link",
                href: "https://chromewebstore.google.com/detail/mhndjbgjljjfcfkojhmhpfcbconnikne?utm_source=item-share-cb",
                label: "打开 Chrome Web Store",
                caption: "安装插件后，可在侧边栏里快速跳回主站的今日日内分析与历史对账。",
              },
            ],
          },
          {
            id: "extension-role",
            title: "插件负责什么",
            blocks: [
              {
                type: "bullets",
                items: [
                  "自动识别当前市场 URL，对应切换城市。",
                  "展示风险徽章、城市档案、今日日内走势简版和多日预报。",
                  "提供今日日内分析、历史对账和返回主站的快捷入口。",
                ],
              },
            ],
          },
          {
            id: "extension-boundary",
            title: "插件不负责什么",
            blocks: [
              {
                type: "paragraph",
                text: "插件不承担完整分析体验，也不承载支付链路。复杂结构判断、历史对账和完整交易语境仍以主站为准。",
              },
              {
                type: "callout",
                tone: "info",
                title: "当前定位",
                text: "插件是“监控 + 基础判断 + 导流回站”的轻量产品，而不是主站的 1:1 复制品。",
              },
            ],
          },
          {
            id: "extension-forecast",
            title: "当前多日预报口径",
            blocks: [
              {
                type: "paragraph",
                text: "插件的多日预报已改为 DEB 优先显示。只有某一天没有 DEB 值时，才回退到原始的日最高温预报值。",
              },
            ],
          },
        ],
      },
      "en-US": {
        title: "Browser Extension",
        description: "The side-panel extension is a lightweight lead-in to the main site. It focuses on monitoring, basic bias, and traffic flow back to the full dashboard.",
        sections: [
          {
            id: "extension-install",
            title: "Install link",
            blocks: [
              {
                type: "link",
                href: "https://chromewebstore.google.com/detail/mhndjbgjljjfcfkojhmhpfcbconnikne?utm_source=item-share-cb",
                label: "Open Chrome Web Store",
                caption: "Once installed, the side panel can route users back into the main intraday analysis and history views.",
              },
            ],
          },
          {
            id: "extension-role",
            title: "What the extension does",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Auto-detects the current market URL and switches the side panel to the matching city.",
                  "Shows risk badges, city profile, a compact intraday chart, and multi-day forecast.",
                  "Provides quick links into the main intraday analysis and history reconciliation views.",
                ],
              },
            ],
          },
          {
            id: "extension-boundary",
            title: "What it does not do",
            blocks: [
              {
                type: "paragraph",
                text: "The extension does not attempt to replicate the full analysis stack and does not carry the payment flow. Deeper structural reasoning and full trade context still live on the main site.",
              },
              {
                type: "callout",
                tone: "info",
                title: "Current positioning",
                text: "Think of the extension as monitoring plus lightweight bias, not as a full dashboard replacement.",
              },
            ],
          },
          {
            id: "extension-forecast",
            title: "Current forecast logic",
            blocks: [
              {
                type: "paragraph",
                text: "The extension now prefers DEB for the multi-day forecast. It falls back to the original daily max only when a DEB value is missing for that date.",
              },
            ],
          },
        ],
      },
    },
  },
];

export function getDocsPage(slug: string) {
  return DOCS_PAGES.find((page) => page.slug === slug) || null;
}
