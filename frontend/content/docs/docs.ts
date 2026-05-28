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
        description: "PolyWeather 文档中心解释核心产品概念、结算口径、日内气象判断、校准概率和模型栈，帮助用户把机场锚点、官方增强层和模型判断转成可执行判断。",
        sections: [
          {
            id: "what-is-polyweather",
            title: "PolyWeather 是什么",
            blocks: [
              { type: "paragraph", text: "PolyWeather 不是通用天气 App。它面向天气衍生品和温度市场，重点回答三个问题：今天最高温大概会落在哪个区间、机场或官方结算站会不会被压温、市场有没有明显错定价。" },
              { type: "callout", tone: "info", title: "产品定位", text: "主站的核心价值不是报天气，而是把模型、机场主站实况、官方增强站网、机场预报和结算规则整合成交易可用的信息。" },
            ],
          },
          {
            id: "core-modules",
            title: "你会在页面上看到什么",
            blocks: [
              { type: "bullets", items: ["锚点状态：先确认当前机场主站实测、日内已见高点和结算时钟。", "当前节奏：把“此刻应到温度”和“机场实测”放在一张卡里，判断今天跑得快还是慢。", "专业气象结论条：先给今日主判断、置信度、基准/上修/下修路径和下一观测点。", "城市决策卡：从地图进入城市简报，读取结构化实况、最高温中枢、市场温度桶和模型-市场差。", "校准模型概率 / 模型区间与分歧：概率层看当前生产概率引擎输出；EMOS / LGBM 只有在评估通过或 shadow 对照时进入解释层，模型区间用于解释分歧。", "气象证据链 / 失效条件 / 确认条件：解释为什么这么判断，以及什么情况会让判断降级。"] },
            ],
          },
          {
            id: "how-to-read",
            title: "如何快速读懂主站",
            blocks: [
              { type: "steps", items: ["先看专业气象结论条或城市决策卡，确认今日主判断、最高温中枢和下一观测点。", "再看锚点状态和今日气温预测图，确认机场实测、DEB、峰值窗口和关键档位线。", "接着看气象证据链、失效条件和确认条件，判断这个路径有没有被新观测破坏。", "最后看校准模型概率、模型区间、市场温度桶和模型-市场差，判断概率是否已经被市场充分计价。"] },
            ],
          },
        ],
      },
      "en-US": {
        title: "Introduction",
        description: "The PolyWeather docs explain the product's core concepts, settlement logic, intraday meteorology, calibrated probability, and model stack so users can turn airport anchors, official nearby networks, and model context into actionable decisions.",
        sections: [
          {
            id: "what-is-polyweather",
            title: "What PolyWeather is",
            blocks: [
              { type: "paragraph", text: "PolyWeather is not a generic weather app. It is built for weather derivatives and temperature markets, with one job: estimate the likely high-temperature bucket, explain whether the airport or official settlement site may get capped, and surface whether the market is mispricing that outcome." },
              { type: "callout", tone: "info", title: "Product focus", text: "The core value is not raw weather reporting. It is the conversion of models, airport-primary observations, official nearby networks, airport forecasts, and settlement rules into usable trading context." },
            ],
          },
          {
            id: "core-modules",
            title: "What you see on the site",
            blocks: [
              { type: "bullets", items: ["Anchor status: current airport-primary observation, day-high-so-far, and the settlement clock.", "Current pace: compares where the airport should be by now versus the actual observation.", "Professional meteorology read: headline, confidence, base/upside/downside path, and next observation point.", "City decision cards: map-launched city briefs with the AI airport read, expected-high center, market bucket, and model-market difference.", "Calibrated model probability / model spread: probability comes from the calibrated engine; spread explains model disagreement.", "Evidence chain / failure modes / confirmation: why the read is valid and what would downgrade it."] },
            ],
          },
          {
            id: "how-to-read",
            title: "How to read the dashboard quickly",
            blocks: [
              { type: "steps", items: ["Start with the professional meteorology read or city decision card: headline, expected-high center, base path, and next observation point.", "Use anchor status and the intraday chart to check current observations, DEB, peak window, and key bucket lines.", "Read the AI airport read, evidence chain, failure modes, and confirmation rules to see whether the path is still valid.", "Then compare calibrated probability, model spread, market bucket, and model-market difference."] },
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
        title: "今日日内分析",
        description: "这页解释今日日内分析如何从气象主判断、证据链、失效条件、TAF 和校准概率组成一套付费判断台。",
        sections: [
          {
            id: "professional-read",
            title: "顶部结论条怎么读",
            blocks: [
              { type: "paragraph", text: "顶部结论条先给主判断和置信度，再给基准、上修、下修路径与下一观测点。它的作用是让用户先知道今天应重点验证哪条路径，而不是先被概率条和市场价格带偏。" },
              { type: "callout", tone: "info", title: "刷新状态", text: "如果完整 detail 或 market scan 仍在同步，日内弹窗会先显示刷新锁，旧内容会降权且不可交互，避免用户把上一轮缓存当成当前结论。" },
            ],
          },
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
        title: "Intraday Analysis",
        description: "This page explains how intraday analysis combines the meteorology headline, evidence chain, failure modes, TAF, and calibrated probability into a paid decision workspace.",
        sections: [
          {
            id: "professional-read",
            title: "How to read the top read",
            blocks: [
              { type: "paragraph", text: "The top read gives the headline and confidence first, then the base, upside, downside path, and next observation point. Its job is to tell users what path to verify before they look at probability bars or market prices." },
              { type: "callout", tone: "info", title: "Refresh state", text: "If full detail or market scan is still syncing, the intraday modal shows a refresh lock first. Old content is de-emphasized and non-interactive so users do not treat stale cached data as the current read." },
            ],
          },
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
    slug: "city-decision-cards",
    group: "analysis",
    content: {
      "zh-CN": {
        title: "城市决策卡",
        description: "这页解释地图城市决策卡如何把结构化实况、最高温中枢、市场温度桶和模型-市场差组合成可验证判断。",
        sections: [
          {
            id: "entry-and-permission",
            title: "从地图进入决策卡",
            blocks: [
              { type: "paragraph", text: "用户可以从地图点击城市进入城市决策卡。机会榜和日历属于 Pro 能力；地图探索和城市简报仍可作为轻量入口使用。" },
              { type: "callout", tone: "info", title: "先天气、后市场", text: "决策卡顶部的天气判断层不读取市场价格，先用结构化实况、DEB 和多模型集合确定最高温中枢，再把该中枢映射到市场温度桶。" },
            ],
          },
          {
            id: "structured-observations",
            title: "结构化实况包括什么",
            blocks: [
              { type: "bullets", items: ["实测锚点：当前温度、当日已见高点、观测时间和数据新鲜度。", "模型区间：DEB、多模型范围，以及模型是否明显分散。", "日内节奏：把实测路径、峰值窗口和目标温度桶放在一起对比。", "市场映射：把最高温中枢映射到 YES/NO 温度桶，并计算模型-市场差。"] },
            ],
          },
          {
            id: "market-layer",
            title: "信号价格层怎么读",
            blocks: [
              { type: "paragraph", text: "温度桶标签来自完整信号桶列表，并会按 label / slug / question 识别 exact、or higher、or lower、range 等方向，避免把 30.5°C 错配到不合理的 16°C 或反向尾部桶。" },
              { type: "callout", tone: "info", title: "模型-信号差", text: "模型-信号差 = 模型概率 − 信号隐含概率。正数表示天气概率高于信号报价；负数表示信号已经把该 YES 计价得更充分。它不是温度变化，也不是收益率。" },
              { type: "paragraph", text: "YES 买入价以可执行报价为主；没有可靠模型概率或 YES 价格时，决策卡会显示报价已匹配但暂不计算模型-信号差。" },
            ],
          },
          {
            id: "cache-behavior",
            title: "为什么切换选项卡后不应重新空白加载",
            blocks: [
              { type: "paragraph", text: "城市决策卡复用城市详情、市场扫描和图表数据缓存，不再单独请求 AI 解读。" },
              { type: "bullets", items: ["城市详情缓存：保存实况、模型、概率和结算上下文。", "市场扫描缓存：完整 all_buckets 结果按城市和日期缓存，默认 TTL 为 10 分钟。", "前端图表缓存：切换城市或选项卡时优先复用已加载的结构化数据。"] },
            ],
          },
        ],
      },
      "en-US": {
        title: "City Decision Cards",
        description: "How the city card combines structured observations, expected-high center, market bucket mapping, and model-market difference into a verifiable decision.",
        sections: [
          {
            id: "entry-and-permission",
            title: "Opening a card from the map",
            blocks: [
              { type: "paragraph", text: "Users can click a city on the map to open its city decision card. The opportunity board and calendar are Pro surfaces; map exploration and city briefs remain the lightweight entry point." },
              { type: "callout", tone: "info", title: "Weather first, market second", text: "The weather decision layer does not use market price input. It first sets the expected-high center from structured observations, DEB, and the model cluster, then maps that center to the relevant market bucket." },
            ],
          },
          {
            id: "structured-observations",
            title: "What structured observations contain",
            blocks: [
              { type: "bullets", items: ["Observation anchor: current temperature, daily high so far, observation time, and freshness.", "Model range: DEB, multi-model range, and whether the model cluster is dispersed.", "Intraday pace: live path, peak window, and target temperature bucket in one comparison.", "Market mapping: maps the expected-high center to YES/NO buckets and calculates the model-market difference."] },
            ],
          },
          {
            id: "market-layer",
            title: "How to read the signal layer",
            blocks: [
              { type: "paragraph", text: "Bucket labels come from the full signal bucket list. The card reads label / slug / question text to distinguish exact, or-higher, or-lower, and range buckets, so a 30.5°C weather center is not matched to an unreasonable 16°C or reverse-tail bucket." },
              { type: "callout", tone: "info", title: "Model-signal difference", text: "Model-signal difference = model probability minus signal-implied probability. A positive value means the weather probability is above signal pricing; a negative value means the YES is already priced more fully by the signal. It is not a temperature delta or return." },
              { type: "paragraph", text: "YES buy uses executable quote data when available. If either model probability or YES price is incomplete, the card shows the quote match but withholds the model-signal difference." },
            ],
          },
          {
            id: "cache-behavior",
            title: "Why tab switching should not blank the card",
            blocks: [
              { type: "paragraph", text: "The card reuses city detail, market scan, and chart-data caches. It no longer makes a separate AI-read request." },
              { type: "bullets", items: ["City detail cache: stores observations, models, probabilities, and settlement context.", "Market-scan cache: stores full all_buckets results by city and date for 10 minutes by default.", "Frontend chart cache: reuses already loaded structured data when switching cities or tabs."] },
            ],
          },
        ],
      },
    },
  },
  {
    slug: "model-stack-deb",
    group: "analysis",
    content: {
      "zh-CN": {
        title: "模型栈与 DEB",
        description: "这页说明 PolyWeather 当前接入哪些开放模型，不同地区为什么看到的模型不一样，以及 DEB 如何避免重复计权。",
        sections: [
          {
            id: "model-sources",
            title: "当前接入的开放模型",
            blocks: [
              { type: "paragraph", text: "PolyWeather 的多模型层通过 Open-Meteo 模型接口接入开放 NWP / AIFS 等预报模型。这里的“来源 Open-Meteo”表示接入接口，不表示 Open-Meteo 是单一模型，也不替代 ECMWF、DWD、ECCC、NOAA、JMA 等机构来源。" },
              { type: "bullets", items: ["ECMWF IFS：全球传统数值模式。", "ECMWF AIFS：ECMWF AIFS 模型，作为独立 AIFS 路径保留。", "DWD ICON：全球 ICON 基准层。", "DWD ICON-EU：欧洲区域高分辨率层。", "DWD ICON-D2：欧洲短时高分辨率层。", "ECCC GEM / GDPS：加拿大系全球模式。", "ECCC RDPS / HRDPS：北美区域与短时高分辨率层。", "GFS / JMA：继续作为全球参考模型保留。"] },
            ],
          },
          {
            id: "regional-coverage",
            title: "为什么欧洲、亚洲、美国城市看到的模型不一样",
            blocks: [
              { type: "paragraph", text: "模型覆盖域不同，所以同一套请求在不同坐标上返回的模型也不同。区域模型不覆盖某个城市时，不会返回空值，也不会在前端显示。" },
              { type: "bullets", items: ["欧洲城市：通常会看到 ECMWF / AIFS / GFS / ICON / ICON-EU / ICON-D2 / GEM 或 GDPS / JMA。欧洲高分辨率重点来自 DWD ICON-EU 和 ICON-D2。", "北美城市：通常会看到 ECMWF / AIFS / GFS / ICON / GEM / GDPS / RDPS / HRDPS / JMA，并继续叠加 NWS。北美高分辨率重点来自 ECCC RDPS 和 HRDPS。", "亚洲城市：通常以 ECMWF / AIFS / GFS / ICON / GEM 或 GDPS / JMA 为主，通常不会有 ICON-EU、ICON-D2、RDPS、HRDPS；亚洲城市更依赖本地官方站、METAR、TAF、JMA、KMA、NMC、HKO、CWA 等观测增强层。"] },
            ],
          },
          {
            id: "deb-dedup",
            title: "DEB 如何处理新增模型",
            blocks: [
              { type: "paragraph", text: "DEB 不会把所有新模型按“每个模型一票”直接等权加入。否则 ICON / ICON-EU / ICON-D2 会让 DWD 模型家族被重复放大，GEM / GDPS / RDPS / HRDPS 也会让加拿大模型家族被重复放大。" },
              { type: "bullets", items: ["ICON / ICON-EU / ICON-D2 归为 DWD ICON 家族，优先级为 ICON-D2 > ICON-EU > ICON。", "GEM / GDPS / RDPS / HRDPS 归为 ECCC GEM 家族，优先级为 HRDPS > RDPS > GDPS > GEM。", "ECMWF IFS 与 ECMWF AIFS 分开保留，因为一个是传统数值模式，一个是 AIFS 模型。", "GFS、JMA、MGM、NWS、LGBM、Open-Meteo 等保持独立路径。", "DEB 权重信息中出现“家族去重”时，表示系统已经先折叠同家族模型，再进行历史 MAE 倒数加权。"] },
              { type: "callout", tone: "info", title: "产品含义", text: "新增模型提升的是区域代表性和解释力，不是让某个地区因为模型数量更多就天然拥有更高权重。" },
            ],
          },
          {
            id: "display",
            title: "网页上如何展示",
            blocks: [
              { type: "paragraph", text: "网页的“模型区间与分歧”会按全球基准、AIFS 模型、欧洲高分辨率、北美高分辨率分组显示，并展示可用模型数量、模型分歧、模型机构、接入接口、模型名称、分辨率和预报时效。没有覆盖的区域模型不会显示。" },
              { type: "callout", tone: "info", title: "概率怎么读", text: "模型票数只解释哪些模型支持某个温度档，不等于最终概率。最终概率优先读取校准模型概率；有 LGBM 时展示 LGBM 校准概率，市场价格只作为参考。" },
            ],
          },
        ],
      },
      "en-US": {
        title: "Model Stack & DEB",
        description: "This page explains which open models PolyWeather uses, why model coverage differs by region, and how DEB avoids duplicate family weighting.",
        sections: [
          {
            id: "model-sources",
            title: "Open models currently integrated",
            blocks: [
              { type: "paragraph", text: "PolyWeather's multi-model layer uses the Open-Meteo model API to integrate open NWP and AIFS model forecasts. The label “source: Open-Meteo” means the integration API, not a single model source, and it does not replace ECMWF, DWD, ECCC, NOAA, or JMA attribution." },
              { type: "bullets", items: ["ECMWF IFS: global traditional NWP.", "ECMWF AIFS: ECMWF AIFS model, kept as a separate AIFS path.", "DWD ICON: global ICON baseline.", "DWD ICON-EU: European regional high-resolution layer.", "DWD ICON-D2: European short-range high-resolution layer.", "ECCC GEM / GDPS: Canadian global model family.", "ECCC RDPS / HRDPS: North American regional and short-range high-resolution layers.", "GFS / JMA: retained as global reference models."] },
            ],
          },
          {
            id: "regional-coverage",
            title: "Why Europe, Asia, and US cities show different models",
            blocks: [
              { type: "paragraph", text: "Model domains differ, so the same request can return different model fields depending on the city coordinates. If a regional model does not cover a city, it is omitted rather than shown as an empty value." },
              { type: "bullets", items: ["European cities usually show ECMWF / AIFS / GFS / ICON / ICON-EU / ICON-D2 / GEM or GDPS / JMA. The high-resolution European layer comes mainly from DWD ICON-EU and ICON-D2.", "North American cities usually show ECMWF / AIFS / GFS / ICON / GEM / GDPS / RDPS / HRDPS / JMA, plus existing NWS context. The high-resolution North American layer comes mainly from ECCC RDPS and HRDPS.", "Asian cities usually rely on ECMWF / AIFS / GFS / ICON / GEM or GDPS / JMA. ICON-EU, ICON-D2, RDPS, and HRDPS usually do not cover Asia, so Asian reads lean more on local official stations, METAR, TAF, JMA, KMA, NMC, HKO, CWA, and other observation enhancement layers."] },
            ],
          },
          {
            id: "deb-dedup",
            title: "How DEB handles the new models",
            blocks: [
              { type: "paragraph", text: "DEB does not treat every new model as one independent vote. Otherwise ICON / ICON-EU / ICON-D2 would over-amplify the DWD family, and GEM / GDPS / RDPS / HRDPS would over-amplify the Canadian family." },
              { type: "bullets", items: ["ICON / ICON-EU / ICON-D2 are collapsed into one DWD ICON family, with priority ICON-D2 > ICON-EU > ICON.", "GEM / GDPS / RDPS / HRDPS are collapsed into one ECCC GEM family, with priority HRDPS > RDPS > GDPS > GEM.", "ECMWF IFS and ECMWF AIFS are kept separate because one is traditional NWP and the other is the AIFS model.", "GFS, JMA, MGM, NWS, LGBM, and Open-Meteo remain independent paths.", "When the DEB weight string includes “family deduplication” or “家族去重”, the system has collapsed same-family models before applying historical inverse-MAE weighting."] },
              { type: "callout", tone: "info", title: "Product meaning", text: "The new models improve regional representativeness and explanation quality. They do not let a region gain extra weight simply because more related model variants exist there." },
            ],
          },
          {
            id: "display",
            title: "How the site displays this",
            blocks: [
              { type: "paragraph", text: "The Model Range & Spread panel groups the model stack into Global Baseline, AIFS Model, Europe High-resolution, and North America High-resolution. It shows available model count, spread, model agency, API, model name, resolution, and forecast horizon. Regional models outside their domain are simply not shown." },
              { type: "callout", tone: "info", title: "How to read probability", text: "Model vote counts explain which models round into a bucket; they are not the final probability. The final probability should come from the calibrated engine. When LGBM is available, the site labels it as LGBM-calibrated probability, while market price remains only a reference." },
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
              { type: "callout", tone: "warning", title: "重点区别", text: "TAF 负责告诉你机场侧未来几个小时会不会出现压温扰动，不直接等于结算温度本身。结算仍然看实际结算站点读数；页面上的官方增强站网只负责领先、偏移和空间分布判断，不会替代机场主站或官方结算站本身。" },
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
              { type: "callout", tone: "warning", title: "Important distinction", text: "TAF explains whether the airport side may face suppressive weather over the next few hours. Settlement still comes from the actual settlement station reading, while the official nearby network is only an enhancement layer for lead/lag and spread, not a replacement anchor." },
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
        description: "不同城市的结算口径不同。理解结算站点，比单纯看模型曲线更重要。",
        sections: [
          {
            id: "why-settlement-matters",
            title: "为什么先看结算站点",
            blocks: [
              { type: "paragraph", text: "同样是“城市最高温”，市场真正结算看的往往不是城区平均温度，而是规则指定的机场或官方站点。交易上最常见的错觉，是把城市体感温度当成结算温度。" },
            ],
          },
          {
            id: "city-rules",
            title: "当前主要口径",
            blocks: [
              { type: "bullets", items: ["多数机场市场：按机场 METAR 或机场主站实况结算。", "土耳其机场市场：机场主站仍以 METAR 为锚点，同时保留 Turkish MGM 作为领先结构参考。", "中国内地机场市场：机场主站仍以 METAR 为锚点，NMC 当前实况作为官方增强层，不直接替代机场结算站。", "日本 / 韩国机场市场：机场主站仍以 METAR 为锚点，同时可接入 JMA / KMA 官方增强层做领先结构参考。", "Manila、Karachi 等新增机场城市按对应 METAR / 机场主站作为锚点。", "香港 / 流浮山 / 台湾等明确官方站点市场：按规则指定的官方结算站点结算，不能拿机场 TAF 或城区体感替代。"] },
            ],
          },
          {
            id: "common-mistakes",
            title: "最常见的误解",
            blocks: [
              { type: "bullets", items: ["TAF 不是结算站点，它只告诉你机场未来有没有压温扰动。", "市场按机场结算时，城区更热不代表市场就该结到更高温桶。", "Wunderground 是历史页面或参考入口，不是物理观测站；机场市场仍以 METAR / 机场主站为锚点。", "官方增强站网是领先参考层，不等于它可以替代机场主站做结算锚点。", "香港、流浮山、台湾等明确官方站点市场，不能简单套用通用机场 TAF / METAR 主链逻辑。"] },
            ],
          },
        ],
      },
      "en-US": {
        title: "Settlement Stations",
        description: "Settlement rules differ by city. Understanding the settlement station matters more than staring only at model curves.",
        sections: [
          {
            id: "why-settlement-matters",
            title: "Why the settlement station comes first",
            blocks: [
              { type: "paragraph", text: "A market may say “city high”, but the true settlement often comes from a designated airport or official site rather than the broader urban feel. One of the most common mistakes is to trade the city feel instead of the actual settlement station." },
            ],
          },
          {
            id: "city-rules",
            title: "Current primary rules",
            blocks: [
              { type: "bullets", items: ["Most airport-linked markets settle on airport METAR or the airport primary observing site.", "Turkish airport markets keep METAR as the airport anchor, with Turkish MGM retained as a leading-structure reference.", "Mainland China airport markets keep METAR as the airport anchor, while NMC current observations act as an official enhancement layer rather than a direct replacement anchor.", "Japanese and Korean airport markets can keep METAR as the anchor while using JMA / KMA nearby-network observations as an official enhancement layer.", "New airport cities such as Manila and Karachi are anchored to their corresponding METAR / airport-primary station.", "Markets with explicitly designated official sites, such as Hong Kong, Lau Fau Shan, and Taiwan station-driven contracts, should be anchored to those official settlement stations rather than generic airport logic."] },
            ],
          },
          {
            id: "common-mistakes",
            title: "Common mistakes",
            blocks: [
              { type: "bullets", items: ["TAF is not the settlement station. It only tells you whether airport-side suppressive weather may appear.", "If the market settles on an airport site, a hotter downtown feel does not automatically justify a warmer settlement bucket.", "Wunderground is a history/reference page, not a physical station. Airport markets still anchor to METAR or the airport primary observing site.", "The official nearby network is a lead/lag and spread layer. It should not be mistaken for the final settlement anchor unless the market explicitly names that station.", "Hong Kong, Lau Fau Shan, and Taiwan station-driven contracts should not be forced into the generic airport TAF / METAR chain."] },
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
        description: "PolyWeather Side Panel 是一个面向天气交易场景的浏览器侧边栏工具，负责自动识别城市、展示简版走势与城市档案，并把用户导回完整分析页面。",
        sections: [
          {
            id: "extension-install",
            title: "安装地址",
            blocks: [
              {
                type: "link",
                href: "https://chromewebstore.google.com/detail/mhndjbgjljjfcfkojhmhpfcbconnikne?utm_source=item-share-cb",
                label: "打开 Chrome Web Store",
                caption: "安装插件后，可在侧边栏里快速跳回主站的今日日内分析。",
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
                  "展示城市档案：结算站点、站点距离、观测更新时间、周边站点数量。",
                  "展示今日日内走势（简版）：DEB 走势与机场主站实况 / 官方增强站网对照，可悬停查看时间与温度。",
                  "展示多日最高温预报（简版），并提供一键刷新与跳转主站入口。",
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
                  "`tabs`：用于识别当前活动标签页 URL 并自动匹配城市。",
                  "`storage`：用于保存插件配置与本地缓存，仅存储在本地浏览器。",
                  "`sidePanel`：用于在浏览器侧边栏展示界面。",
                  "插件不要求用户登录，不收集个人身份信息，不上传浏览历史，仅在必要时请求天气接口数据。",
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
                text: "插件不承担完整分析体验，也不承载支付链路。复杂结构判断和完整交易语境仍以主站为准。",
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
        description: "PolyWeather Side Panel is a browser side-panel tool for weather trading workflows. It auto-detects cities, shows compact intraday and city-profile context, and routes users back to the full dashboard.",
        sections: [
          {
            id: "extension-install",
            title: "Install link",
            blocks: [
              {
                type: "link",
                href: "https://chromewebstore.google.com/detail/mhndjbgjljjfcfkojhmhpfcbconnikne?utm_source=item-share-cb",
                label: "Open Chrome Web Store",
                caption: "Once installed, the side panel can route users back into the main intraday analysis.",
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
                  "Shows a compact intraday chart with DEB versus airport-primary observations and official nearby-network observations, including hoverable time and temperature.",
                  "Shows a compact multi-day daily-high forecast, plus refresh and jump-to-site actions.",
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
                  "The extension does not require login, does not collect personally identifiable information, and does not upload browsing history. It only requests weather endpoints when needed to render the panel.",
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
