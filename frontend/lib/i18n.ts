export type Locale = "zh-CN" | "en-US";

type MessageParams = Record<string, string | number>;

const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_STORAGE_KEY = "polyweather.locale";

const MESSAGES: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    "header.subtitle": "天气衍生品智能分析",
    "header.info": "技术说明",
    "header.infoAria": "查看系统技术说明",
    "header.live": "实时",
    "header.refreshAria": "刷新所有数据",
    "header.langAria": "切换语言",
    "header.langZh": "中文",
    "header.langEn": "EN",

    "sidebar.title": "监控城市",
    "sidebar.peakAt": "峰值 @ {time}",

    "dashboard.loading": "正在获取气象数据，请稍候...",

    "detail.closeAria": "关闭城市详情面板",
    "detail.waitSelect": "等待选择城市",
    "detail.todayAnalysis": "今日日内分析",
    "detail.history": "历史对账",
    "detail.loading": "正在加载城市详情...",
    "detail.emptyHint": "从左侧城市列表选择一个城市查看详情。",
    "detail.sceneryAlt": "{city} 风景照",
    "detail.sceneryTitle": "城市风景与微气候",
    "detail.sceneryFallback":
      "当前没有匹配到风景图，可从下方城市档案查看站点与观测结构。",
    "detail.profile": "城市档案",
    "detail.todayMiniTrend": "今日日内走势（简版）",
    "detail.chartLegendEmpty": "暂无小时级实测或预测曲线。",

    "forecast.title": "多日预报",
    "forecast.empty": "暂无多日预报",
    "forecast.today": "今天",

    "guide.title": "📎 PolyWeather 系统技术说明",
    "guide.closeAria": "关闭技术说明",
    "guide.footer":
      "数据源以 Aviation Weather / METAR、Turkish MGM、Open-Meteo、weather.gov 为主，部分城市补充 Meteoblue。",

    "history.title": "📊 历史准确率对账 - {city}",
    "history.closeAria": "关闭历史对账",
    "history.loading": "正在获取历史数据...",
    "history.error": "获取历史信息失败",
    "history.empty": "近 15 天暂无该城市历史数据",
    "history.hitRate": "DEB 结算胜率 (WU)",
    "history.mae": "DEB MAE",
    "history.sample": "近 15 天已结算样本",
    "history.sampleDays": "{count} 天",

    "future.todayTitle": "{city} · 今日日内分析",
    "future.dateTitle": "{city} · {date} 未来日期分析",
    "future.closeTodayAria": "关闭今日日内分析",
    "future.closeDateAria": "关闭未来日期分析",
    "future.currentObs": "当前实测",
    "future.currentWeather": "当前天气",
    "future.wuRef": "WU 结算参考",
    "future.sunrise": "日出时间",
    "future.sunset": "日落时间",
    "future.sunshine": "日照时长",
    "future.todayForecastHigh": "今日预报高温",
    "future.targetForecast": "目标日预报",
    "future.deb": "DEB 预测",
    "future.mu": "动态分布中心",
    "future.score": "趋势评分",
    "future.todayTempTrend": "今日温度走势",
    "future.targetTempTrend": "目标日小时走势",
    "future.probability": "结算概率分布",
    "future.models": "多模型预报",
    "future.structureToday": "今日日内结构信号",
    "future.structureDate": "未来 6-48 小时趋势",
    "future.judgement": "判断",
    "future.confidence": "置信度",
    "future.maxPrecip": "最大降水概率",
    "future.ai": "AI 深度分析",
    "future.noAi": "暂无 AI 分析，当前以结构化气象与模型数据为主。",
    "future.weatherGov": "weather.gov 文本",
    "future.risk": "结算与偏差风险",
    "future.climate": "当地气候主要受什么影响",
    "future.chartLegendEmpty": "暂无机场报文或小时级实测数据",

    "confidence.high": "高",
    "confidence.medium": "中",
    "confidence.low": "低",

    "section.todayTempTrend": "今日温度走势",
    "section.chartEmpty": "暂无小时级数据",
    "section.probability": "结算概率分布",
    "section.mu": "动态分布中心 μ = {value}{unit}",
    "section.noProb": "暂无概率数据",
    "section.models": "多模型预报",
    "section.noModels": "暂无多模型预报",
    "section.ai": "AI 深度分析",
    "section.aiEmpty": "暂无 AI 分析，当前以结构化气象与模型数据为主。",
    "section.risk": "数据偏差风险",
    "section.noRiskProfile": "暂无风险档案",
    "section.airport": "机场",
    "section.distance": "距离",
    "section.note": "注意",

    "common.na": "--",
  },
  "en-US": {
    "header.subtitle": "Weather Derivatives Intelligence",
    "header.info": "Tech Notes",
    "header.infoAria": "Open system technical notes",
    "header.live": "LIVE",
    "header.refreshAria": "Refresh all data",
    "header.langAria": "Switch language",
    "header.langZh": "中文",
    "header.langEn": "EN",

    "sidebar.title": "Monitored Cities",
    "sidebar.peakAt": "Peak @ {time}",

    "dashboard.loading": "Loading weather data, please wait...",

    "detail.closeAria": "Close city detail panel",
    "detail.waitSelect": "Waiting for city selection",
    "detail.todayAnalysis": "Today's Intraday",
    "detail.history": "History Reconciliation",
    "detail.loading": "Loading city details...",
    "detail.emptyHint": "Select a city from the left list to view details.",
    "detail.sceneryAlt": "{city} scenery",
    "detail.sceneryTitle": "City Scenery & Microclimate",
    "detail.sceneryFallback":
      "No scenery image matched. You can still review station and observation profile below.",
    "detail.profile": "City Profile",
    "detail.todayMiniTrend": "Today's Intraday Trend (Compact)",
    "detail.chartLegendEmpty": "No hourly observations or forecast curve available.",

    "forecast.title": "Multi-day Forecast",
    "forecast.empty": "No multi-day forecast available",
    "forecast.today": "Today",

    "guide.title": "📎 PolyWeather Technical Overview",
    "guide.closeAria": "Close technical overview",
    "guide.footer":
      "Primary data sources are Aviation Weather / METAR, Turkish MGM, Open-Meteo, and weather.gov, with Meteoblue added for selected cities.",

    "history.title": "📊 Historical Reconciliation - {city}",
    "history.closeAria": "Close history reconciliation",
    "history.loading": "Loading historical data...",
    "history.error": "Failed to load historical data",
    "history.empty": "No historical records for this city in the last 15 days",
    "history.hitRate": "DEB Settlement Hit Rate (WU)",
    "history.mae": "DEB MAE",
    "history.sample": "Settled Samples (Last 15 Days)",
    "history.sampleDays": "{count} days",

    "future.todayTitle": "{city} · Intraday Analysis",
    "future.dateTitle": "{city} · {date} Future-date Analysis",
    "future.closeTodayAria": "Close intraday analysis",
    "future.closeDateAria": "Close future-date analysis",
    "future.currentObs": "Current Observation",
    "future.currentWeather": "Current Weather",
    "future.wuRef": "WU Settlement Ref",
    "future.sunrise": "Sunrise",
    "future.sunset": "Sunset",
    "future.sunshine": "Sunshine Duration",
    "future.todayForecastHigh": "Today's Forecast High",
    "future.targetForecast": "Target-day Forecast",
    "future.deb": "DEB Forecast",
    "future.mu": "Dynamic Distribution Center",
    "future.score": "Trend Score",
    "future.todayTempTrend": "Today's Temperature Trend",
    "future.targetTempTrend": "Target-day Hourly Trend",
    "future.probability": "Settlement Probability Distribution",
    "future.models": "Multi-model Forecast",
    "future.structureToday": "Intraday Structural Signal",
    "future.structureDate": "6-48h Structural Trend",
    "future.judgement": "Judgement",
    "future.confidence": "Confidence",
    "future.maxPrecip": "Max Precip Probability",
    "future.ai": "AI Deep Analysis",
    "future.noAi": "No AI analysis available. Structured meteorological and model data are used as baseline.",
    "future.weatherGov": "weather.gov text",
    "future.risk": "Settlement & Deviation Risk",
    "future.climate": "What Mainly Drives Local Climate",
    "future.chartLegendEmpty": "No METAR bulletin or hourly observations available",

    "confidence.high": "High",
    "confidence.medium": "Medium",
    "confidence.low": "Low",

    "section.todayTempTrend": "Today's Temperature Trend",
    "section.chartEmpty": "No hourly data available",
    "section.probability": "Settlement Probability Distribution",
    "section.mu": "Dynamic center μ = {value}{unit}",
    "section.noProb": "No probability data available",
    "section.models": "Multi-model Forecast",
    "section.noModels": "No multi-model forecast available",
    "section.ai": "AI Deep Analysis",
    "section.aiEmpty": "No AI analysis available. Structured meteorological and model data are currently used.",
    "section.risk": "Data Deviation Risk",
    "section.noRiskProfile": "No risk profile available",
    "section.airport": "Airport",
    "section.distance": "Distance",
    "section.note": "Note",

    "common.na": "--",
  },
};

export function normalizeLocale(value?: string | null): Locale {
  if (!value) return DEFAULT_LOCALE;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("en")) return "en-US";
  return "zh-CN";
}

export function getInitialLocaleFromNavigator(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return normalizeLocale(window.navigator.language);
}

export function formatMessage(
  locale: Locale,
  key: string,
  params?: MessageParams,
): string {
  const template =
    MESSAGES[locale]?.[key] || MESSAGES[DEFAULT_LOCALE][key] || key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, token) => {
    const value = params[token];
    return value == null ? "" : String(value);
  });
}
