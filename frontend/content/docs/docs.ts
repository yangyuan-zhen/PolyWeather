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
  group: "getting-started" | "analysis" | "settlement";
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
        description: "PolyWeather 是结算源优先的天气决策台，帮助用户围绕真实观测、DEB 路径、市场信号和结算规则判断温度市场。",
        sections: [
          {
            id: "what-is-polyweather",
            title: "PolyWeather 是什么",
            blocks: [
              {
                type: "paragraph",
                text: "PolyWeather 不是通用天气 App，也不是单纯的预报展示页。它把结算跑道、官方站、机场报文、DEB Forecast、市场阈值和源头刷新状态放到同一个工作流里，服务温度市场的日内判断。",
              },
              {
                type: "callout",
                tone: "info",
                title: "产品定位",
                text: "先确认结算源和实测更新，再比较 DEB 与市场信号。市场价格是判断层，不替代真实结算站点或跑道观测。",
              },
            ],
          },
          {
            id: "current-terminal",
            title: "当前工作台有哪些",
            blocks: [
              {
                type: "bullets",
                items: [
                  "天气决策 / 训练数据 / 使用指南：左侧导航对应当前主工作台的三个入口。",
                  "1-9 个图表槽位：可用 1x1 到 3x3 布局同时观察多个城市，并在每个槽位切换城市。",
                  "实测锚点：优先显示结算跑道、官方站或关键机场报文，并展示当前温度、当日已见高点和更新时间。",
                  "DEB Forecast：橙色路径用于判断后续升温或降温空间，以及峰值窗口附近是否偏离主路径。",
                  "市场信号：阈值、价格、流动性和优势用于交易判断，但要先由天气证据确认。",
                  "训练数据：用于复盘 DEB 和概率引擎近期表现，帮助判断哪些城市当前更可靠。",
                ],
              },
            ],
          },
          {
            id: "quick-read",
            title: "如何快速读懂主站",
            blocks: [
              {
                type: "steps",
                items: [
                  "先选择区域和城市，把重点城市放进图表槽位。",
                  "先看青绿色实测锚点，确认当前温度、当日最高和数据新鲜度。",
                  "再看 DEB Forecast 与高温 / 全天视图，判断剩余升温空间和峰值窗口。",
                  "最后打开模型线、跑道明细或市场信号，确认分歧来自天气还是价格。",
                ],
              },
            ],
          },
        ],
      },
      "en-US": {
        title: "Introduction",
        description: "PolyWeather is a settlement-source-first weather decision terminal for reading live observations, the DEB path, market signals, and settlement rules.",
        sections: [
          {
            id: "what-is-polyweather",
            title: "What PolyWeather is",
            blocks: [
              {
                type: "paragraph",
                text: "PolyWeather is not a general weather app or a raw forecast page. It puts settlement runways, official stations, airport reports, DEB Forecast, market thresholds, and source freshness into one workflow for intraday temperature-market decisions.",
              },
              {
                type: "callout",
                tone: "info",
                title: "Product focus",
                text: "Confirm the settlement source and live update state first, then compare DEB with market signals. Market price is a decision layer, not a replacement for the actual settlement station or runway observation.",
              },
            ],
          },
          {
            id: "current-terminal",
            title: "What the current terminal exposes",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Weather Decisions / Training / Guide: the three entries in the current left-side terminal navigation.",
                  "1-9 chart slots: use 1x1 through 3x3 layouts to monitor several cities and switch each slot independently.",
                  "Live anchors: settlement runway, official station, or useful airport report, with current temperature, day high, and freshness.",
                  "DEB Forecast: the orange path for remaining upside or downside and for checking the peak window.",
                  "Market signals: thresholds, price, liquidity, and edge support trade decisions after the weather evidence is checked.",
                  "Training data: recent DEB and probability-engine performance for judging which cities are more reliable now.",
                ],
              },
            ],
          },
          {
            id: "quick-read",
            title: "How to read the terminal quickly",
            blocks: [
              {
                type: "steps",
                items: [
                  "Pick a region and city, then place the important cities into chart slots.",
                  "Start with the teal live anchor: current temperature, day high, and freshness.",
                  "Compare DEB Forecast in Peak / All Day views to judge remaining move and peak-window risk.",
                  "Use model lines, runway detail, or market signals last to separate weather disagreement from price disagreement.",
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    slug: "chart-guide",
    group: "getting-started",
    content: {
      "zh-CN": {
        title: "如何读 PolyWeather 图表",
        description: "这页解释当前温度图的阅读顺序、图层、视图模式和常见误读。",
        sections: [
          {
            id: "read-order",
            title: "先读什么",
            blocks: [
              {
                type: "steps",
                items: [
                  "先看结算源实测：结算跑道、官方站或当前更可靠的机场报文是不是还在更新。",
                  "再看 DEB Forecast：它是融合模型和日内修正后的预期路径，不是已经发生的实测。",
                  "切换高温 / 全天：高温视图聚焦峰值窗口，全天视图用于复盘完整日内走势。",
                  "最后看图层和市场信号：只有当实测与 DEB 或价格明显分叉时，才需要打开更多辅助层。",
                ],
              },
            ],
          },
          {
            id: "layers",
            title: "图层怎么理解",
            blocks: [
              {
                type: "bullets",
                items: [
                  "实测 / 结算线：默认优先展示，代表最接近结算口径的实时温度。",
                  "DEB Forecast：橙色预测路径，重点看它和实测线在峰值窗口前后的差距。",
                  "机场报文：METAR / MGM 等作为机场站参考，只在适合的城市默认显示。",
                  "模型线：ECMWF、GFS、ICON、GEM 等提供背景，默认作为辅助判断。",
                  "跑道明细：打开后可看各跑道传感器；关闭后仍保留结算跑道或主参考站。",
                ],
              },
            ],
          },
          {
            id: "advanced-variables",
            title: "高级气象变量",
            blocks: [
              {
                type: "paragraph",
                text: "风速、风向、露点、湿度和气压用于解释压温、海风、云雨和边界层变化，但它们不是温度结算曲线。",
              },
              {
                type: "callout",
                tone: "info",
                title: "默认隐藏",
                text: "高级气象变量默认隐藏，只在需要解释结构变化时作为上下文展开，避免主图被非温度曲线挤占。",
              },
            ],
          },
          {
            id: "common-misreads",
            title: "常见误读",
            blocks: [
              {
                type: "bullets",
                items: [
                  "不要把概率温度带当成实测曲线。概率层用于市场判断和后台分析，不代表某一刻真实温度。",
                  "不要把市场信号当成结算温度。结算仍然看规则指定的站点或跑道。",
                  "不要要求所有城市固定 1 分钟刷新。图表更新频率取决于源头原生频率和当前可用数据。",
                ],
              },
            ],
          },
        ],
      },
      "en-US": {
        title: "How To Read PolyWeather Charts",
        description: "A guide to the current temperature chart reading order, layers, view modes, and common misreads.",
        sections: [
          {
            id: "read-order",
            title: "Read order",
            blocks: [
              {
                type: "steps",
                items: [
                  "Start with the settlement-source observation: settlement runway, official station, or the most useful airport report.",
                  "Read DEB Forecast next. It is the model-and-intraday adjusted path, not an observation that already happened.",
                  "Switch Peak / All Day views: Peak focuses the payoff window, while All Day reviews the full intraday path.",
                  "Use layers and market signals last, mainly when live observations diverge from DEB or price.",
                ],
              },
            ],
          },
          {
            id: "layers",
            title: "Chart layers",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Live / settlement line: visible by default and closest to the settlement rule.",
                  "DEB Forecast: orange forecast path; focus on its gap versus live observations near the peak window.",
                  "Airport reports: METAR / MGM are airport references and are auto-shown only where useful.",
                  "Model lines: ECMWF, GFS, ICON, GEM, and related layers provide background context.",
                  "Runway detail: enable it to inspect runway sensors; disabling it still keeps the settlement runway or primary reference.",
                ],
              },
            ],
          },
          {
            id: "advanced-variables",
            title: "Advanced weather variables",
            blocks: [
              {
                type: "paragraph",
                text: "Wind speed, wind direction, dew point, humidity, and pressure help explain suppression, sea-breeze timing, cloud/rain risk, and boundary-layer structure, but they are not settlement-temperature curves.",
              },
              {
                type: "callout",
                tone: "info",
                title: "Hidden by default",
                text: "Advanced variables stay hidden by default and appear only as context when structure needs explanation, so the main chart is not crowded by non-temperature lines.",
              },
            ],
          },
          {
            id: "common-misreads",
            title: "Common misreads",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Do not read probability bands as observation curves. Probability supports market analysis and background scoring, not timestamped live temperature.",
                  "Do not treat market signals as settlement temperature. Settlement still comes from the station or runway named by the rule.",
                  "Do not expect every city to update every minute. Refresh cadence follows source-native frequency and current data availability.",
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    slug: "realtime-sources",
    group: "settlement",
    content: {
      "zh-CN": {
        title: "实时数据频率",
        description: "这页解释为什么不同城市刷新频率不同，以及网站、缓存和 SSE patch 之间的关系。",
        sections: [
          {
            id: "source-cadence",
            title: "按源频率采集",
            blocks: [
              {
                type: "bullets",
                items: [
                  "AMOS 60s：首尔、釜山等韩国跑道传感器。",
                  "AMSC 180s：中国内地跑道端点观测城市。",
                  "MADIS 300s：美国高频机场观测城市。",
                  "CoWIN 60s：香港 6087 参考站。",
                  "HKO 600s：香港天文台官方 10 分钟层。",
                  "CWA / JMA / FMI / KNMI / MGM：按各自官方或可用频率采集。",
                ],
              },
            ],
          },
          {
            id: "pipeline",
            title: "网站怎么更新",
            blocks: [
              {
                type: "paragraph",
                text: "观测 collector 按源头原生频率采集，并写入缓存或数据库。前端先读取完整快照，之后通过 SSE patch 合并 city_observation_patch.v1 增量更新。",
              },
              {
                type: "callout",
                tone: "info",
                title: "SSE patch",
                text: "可见图表会订阅实时 patch；如果一段时间没有收到 patch，才做轻量兜底刷新，避免多个入口同时强刷同一外部源。",
              },
            ],
          },
          {
            id: "telegram",
            title: "Telegram 和网站的关系",
            blocks: [
              {
                type: "paragraph",
                text: "Telegram 默认读取最新缓存或数据库，不主动强制刷新观测源。只有完全没有缓存时，才允许兜底分析。",
              },
            ],
          },
        ],
      },
      "en-US": {
        title: "Realtime Source Cadence",
        description: "Why cities update at different speeds, and how the website, cache, and SSE patches relate to each other.",
        sections: [
          {
            id: "source-cadence",
            title: "Source-native cadence",
            blocks: [
              {
                type: "bullets",
                items: [
                  "AMOS 60s: Korean runway sensors such as Seoul and Busan.",
                  "AMSC 180s: mainland China runway endpoint observations.",
                  "MADIS 300s: US high-frequency airport observations.",
                  "CoWIN 60s: Hong Kong 6087 reference station.",
                  "HKO 600s: Hong Kong Observatory official 10-minute layer.",
                  "CWA / JMA / FMI / KNMI / MGM: collected at each source's official or available cadence.",
                ],
              },
            ],
          },
          {
            id: "pipeline",
            title: "How the site updates",
            blocks: [
              {
                type: "paragraph",
                text: "The observation collector samples each source at its native cadence and writes cache or database state. The frontend reads a full snapshot first, then merges city_observation_patch.v1 updates through SSE patch.",
              },
              {
                type: "callout",
                tone: "info",
                title: "SSE patch",
                text: "Visible charts subscribe to live patches. If patches stop for a while, the chart can make a lightweight fallback refresh instead of making every entry point force-refresh the same external source.",
              },
            ],
          },
          {
            id: "telegram",
            title: "How Telegram relates",
            blocks: [
              {
                type: "paragraph",
                text: "Telegram reads the latest cache or database state by default and does not force-refresh observation sources. It only falls back to analysis when no cache exists at all.",
              },
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
        title: "结算站点说明",
        description: "不同市场的结算口径不同。先确认结算站点，再判断 DEB、实测和市场信号。",
        sections: [
          {
            id: "why-settlement-matters",
            title: "为什么先看结算站点",
            blocks: [
              {
                type: "paragraph",
                text: "同样是城市最高温，真正结算可能看机场 METAR、机场主站、结算跑道，也可能看明确指定的官方结算站点。城区更热或体感更热，不一定等于合约会结到更高温桶。",
              },
            ],
          },
          {
            id: "primary-rules",
            title: "当前主要口径",
            blocks: [
              {
                type: "bullets",
                items: [
                  "多数机场市场：先看机场 METAR、机场主站或项目标记的机场主参考站。",
                  "跑道城市：优先看结算跑道或项目标记的主跑道端点，同时保留辅助跑道作为空间背景。",
                  "明确官方站点市场：按规则指定的官方结算站点结算，不能用通用机场逻辑替代。",
                  "本地官方增强层：JMA、KMA、NMC、HKO、CWA、MGM 等用于领先结构和交叉验证，是否能做结算锚点取决于合约规则。",
                  "TAF：用于判断机场未来云雨、雷暴或风向变化，不是结算温度本身。",
                ],
              },
            ],
          },
          {
            id: "how-to-check",
            title: "页面上怎么确认",
            blocks: [
              {
                type: "steps",
                items: [
                  "先看图表里的实测 / 结算线名称和统计条，确认当前主锚点。",
                  "再看更新时间和数据新鲜度，排除停更或滞后源。",
                  "如果打开跑道明细，先读结算跑道，再用辅助跑道判断空间差异。",
                  "最后才把 DEB、市场信号和概率判断叠上去。",
                ],
              },
            ],
          },
        ],
      },
      "en-US": {
        title: "Settlement Stations",
        description: "Settlement rules differ by market. Confirm the station first, then read DEB, observations, and market signals.",
        sections: [
          {
            id: "why-settlement-matters",
            title: "Why the settlement station comes first",
            blocks: [
              {
                type: "paragraph",
                text: "A city-high market may settle from airport METAR, an airport primary site, a settlement runway, or an explicitly named official settlement station. A hotter downtown feel does not automatically mean the contract settles into a warmer bucket.",
              },
            ],
          },
          {
            id: "primary-rules",
            title: "Current primary rules",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Most airport-linked markets: start with airport METAR, the airport primary site, or the project's marked airport reference.",
                  "Runway cities: prioritize the settlement runway or marked primary runway endpoint, while auxiliary runways remain spatial context.",
                  "Explicit official-station markets: settle from the official settlement station named by the rule, not from generic airport logic.",
                  "Local official enhancement layers: JMA, KMA, NMC, HKO, CWA, MGM, and similar sources help with lead/lag and cross-checks; whether they anchor settlement depends on the contract rule.",
                  "TAF: useful for cloud, thunderstorm, or wind-shift risk near the airport, but not the settlement temperature itself.",
                ],
              },
            ],
          },
          {
            id: "how-to-check",
            title: "How to check on the page",
            blocks: [
              {
                type: "steps",
                items: [
                  "Read the live / settlement line name and summary stats to identify the current anchor.",
                  "Check timestamp and freshness so stale sources do not drive the decision.",
                  "When runway detail is enabled, read the settlement runway first and use auxiliary runways for spatial spread.",
                  "Only then add DEB, market signals, and probability context.",
                ],
              },
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
        description: "PolyWeather Side Panel 是浏览器侧边栏工具，用于快速识别城市、查看简版走势，并跳回完整天气决策台。",
        sections: [
          {
            id: "extension-install",
            title: "安装地址",
            blocks: [
              {
                type: "link",
                href: "https://chromewebstore.google.com/detail/mhndjbgjljjfcfkojhmhpfcbconnikne?utm_source=item-share-cb",
                label: "打开 Chrome Web Store",
                caption: "安装后可在浏览器侧边栏查看简版城市走势，并跳回主站。",
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
                  "自动识别当前页面中的城市，也支持手动切换。",
                  "展示城市档案：结算站点、站点距离、观测更新时间和周边站点数量。",
                  "展示简版日内走势：DEB 与机场主站或官方参考站对照，可悬停查看时间与温度。",
                  "展示简版多日最高温预报，并提供刷新和跳回主站入口。",
                ],
              },
            ],
          },
          {
            id: "extension-permission",
            title: "权限与隐私",
            blocks: [
              {
                type: "bullets",
                items: [
                  "`tabs`：用于识别当前活动标签页 URL 并匹配城市。",
                  "`storage`：用于保存插件配置与本地缓存，仅存储在本地浏览器。",
                  "`sidePanel`：用于在浏览器侧边栏展示界面。",
                  "插件不要求用户登录，不收集个人身份信息，不上传浏览历史，仅在需要渲染侧边栏时请求天气接口数据。",
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
                text: "插件不承担完整分析体验，也不承载支付链路。多图表巡检、训练数据、权益状态和完整市场判断仍以主站为准。",
              },
            ],
          },
        ],
      },
      "en-US": {
        title: "Browser Extension",
        description: "PolyWeather Side Panel is a browser side-panel tool for quick city detection, compact chart context, and returning to the full weather decision terminal.",
        sections: [
          {
            id: "extension-install",
            title: "Install link",
            blocks: [
              {
                type: "link",
                href: "https://chromewebstore.google.com/detail/mhndjbgjljjfcfkojhmhpfcbconnikne?utm_source=item-share-cb",
                label: "Open Chrome Web Store",
                caption: "After installation, the side panel can show compact city context and route back to the main site.",
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
                  "Auto-detects the current page city, with manual switching also available.",
                  "Shows a city profile with settlement station, station distance, observation timestamp, and nearby station count.",
                  "Shows a compact intraday chart with DEB against the airport primary or official reference station, including hoverable time and temperature.",
                  "Shows a compact multi-day high forecast, plus refresh and return-to-site actions.",
                ],
              },
            ],
          },
          {
            id: "extension-permission",
            title: "Permissions and privacy",
            blocks: [
              {
                type: "bullets",
                items: [
                  "`tabs`: used to inspect the active tab URL and match the current city.",
                  "`storage`: used for local configuration and local cache only.",
                  "`sidePanel`: used to render the browser side panel UI.",
                  "The extension does not require login, does not collect personally identifiable information, and does not upload browsing history. It only requests weather endpoints when rendering the side panel.",
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
                text: "The extension does not carry the full analysis experience or payment flow. Multi-chart monitoring, training data, entitlement state, and complete market context stay on the main site.",
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
