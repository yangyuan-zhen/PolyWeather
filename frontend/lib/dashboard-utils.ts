import { Locale } from "@/lib/i18n";
import {
  AiAnalysisStructured,
  CityDetail,
  HistoryPoint,
  NearbyStation,
} from "@/lib/dashboard-types";

const METAR_WX_MAP: Record<
  string,
  { en: string; icon: string; zh: string }
> = {
  VCSH: { en: "Showers nearby", icon: "🌦️", zh: "附近有阵雨" },
  SHRA: { en: "Rain showers", icon: "🌦️", zh: "阵雨" },
  "-SHRA": { en: "Light rain showers", icon: "🌦️", zh: "小阵雨" },
  "+SHRA": { en: "Heavy rain showers", icon: "⛈️", zh: "强阵雨" },
  VCRA: { en: "Rain nearby", icon: "🌧️", zh: "附近有降雨" },
  TSRA: { en: "Thunderstorms with rain", icon: "⛈️", zh: "雷雨" },
  "-TSRA": { en: "Light thunderstorms with rain", icon: "⛈️", zh: "小雷雨" },
  "+TSRA": { en: "Heavy thunderstorms with rain", icon: "⛈️", zh: "强雷雨" },
  RA: { en: "Rain", icon: "🌧️", zh: "降雨" },
  "-RA": { en: "Light rain", icon: "🌦️", zh: "小雨" },
  "+RA": { en: "Heavy rain", icon: "⛈️", zh: "强降雨" },
  SN: { en: "Snow", icon: "❄️", zh: "降雪" },
  "-SN": { en: "Light snow", icon: "🌨️", zh: "小雪" },
  "+SN": { en: "Heavy snow", icon: "🌨️", zh: "大雪" },
  DZ: { en: "Drizzle", icon: "🌦️", zh: "毛毛雨" },
  FG: { en: "Fog", icon: "🌫️", zh: "雾" },
  VCFG: { en: "Fog nearby", icon: "🌫️", zh: "附近有雾" },
  MIFG: { en: "Shallow fog", icon: "🌫️", zh: "浅雾" },
  BR: { en: "Mist", icon: "🌫️", zh: "薄雾" },
  HZ: { en: "Haze", icon: "🌫️", zh: "霾" },
  TS: { en: "Thunderstorm", icon: "⛈️", zh: "雷暴" },
  VCTS: { en: "Nearby thunderstorm", icon: "⛈️", zh: "附近雷暴" },
  SQ: { en: "Squall", icon: "💨", zh: "飑线" },
  GS: { en: "Hail", icon: "🌨️", zh: "冰雹" },
};

function isEnglish(locale: Locale) {
  return locale === "en-US";
}

function containsCjk(text: string) {
  return /[\u3400-\u9fff]/.test(text);
}

function getObservationSourceCode(detail: CityDetail): string {
  const source = String(detail.current?.settlement_source || "")
    .trim()
    .toLowerCase();
  if (source) return source;

  const city = String(detail.name || detail.display_name || "")
    .trim()
    .toLowerCase();
  if (city === "hong kong") return "hko";
  if (city === "taipei") return "noaa";
  return "metar";
}

function getObservationSourceTag(detail: CityDetail): string {
  const label = String(detail.current?.settlement_source_label || "")
    .trim()
    .toUpperCase();
  if (label) return label;
  const code = getObservationSourceCode(detail);
  if (code === "hko") return "HKO";
  if (code === "cwa") return "CWA";
  if (code === "noaa") return "NOAA";
  if (code === "mgm") return "MGM";
  return "METAR";
}

function normalizeCloudSummary(
  cloudDesc: string | null | undefined,
  locale: Locale,
): { icon: string; text: string } {
  const raw = String(cloudDesc || "").trim();
  if (!raw) {
    return { icon: "🔍", text: isEnglish(locale) ? "Unknown" : "未知" };
  }

  const lower = raw.toLowerCase();
  if (
    raw.includes("晴") ||
    raw.includes("晴朗") ||
    lower.includes("clear") ||
    lower.includes("sunny")
  ) {
    return { icon: "☀️", text: isEnglish(locale) ? "Clear" : "晴朗" };
  }
  if (raw.includes("阴") || lower.includes("overcast")) {
    return { icon: "☁️", text: isEnglish(locale) ? "Overcast" : "阴天" };
  }
  if (raw.includes("多云") || lower.includes("cloud")) {
    return { icon: "☁️", text: isEnglish(locale) ? "Cloudy" : "多云" };
  }
  if (raw.includes("少云") || lower.includes("few")) {
    return { icon: "🌤️", text: isEnglish(locale) ? "Mostly clear" : "少云" };
  }
  if (raw.includes("散云") || lower.includes("scattered")) {
    return { icon: "⛅", text: isEnglish(locale) ? "Partly cloudy" : "散云" };
  }
  return { icon: "🔍", text: raw };
}

export function translateMetar(code?: string | null, locale: Locale = "zh-CN") {
  if (!code) return null;
  const metarCode = String(code);
  for (const [key, value] of Object.entries(METAR_WX_MAP)) {
    if (metarCode.includes(key)) {
      return {
        icon: value.icon,
        label: isEnglish(locale) ? value.en : value.zh,
      };
    }
  }
  return { icon: "🔍", label: metarCode };
}

export function getRiskBadgeLabel(
  level?: string | null,
  locale: Locale = "zh-CN",
) {
  if (isEnglish(locale)) {
    return (
      {
        high: "🔴 High Risk",
        low: "🟢 Low Risk",
        medium: "🟠 Medium Risk",
      }[String(level || "low")] || "Unknown Risk"
    );
  }
  return (
    {
      high: "🔴 高风险",
      low: "🟢 低风险",
      medium: "🟠 中风险",
    }[String(level || "low")] || "未知风险"
  );
}

export function getWeatherSummary(detail: CityDetail, locale: Locale = "zh-CN") {
  const current = detail.current || {};
  const cloud = normalizeCloudSummary(current.cloud_desc, locale);
  let weatherText = cloud.text;
  let weatherIcon = cloud.icon;

  if (current.wx_desc) {
    const translated = translateMetar(current.wx_desc, locale);
    if (translated) {
      weatherText = translated.label;
      weatherIcon = translated.icon;
    }
  }

  return { weatherIcon, weatherText };
}

export function getHeroMetaItems(detail: CityDetail, locale: Locale = "zh-CN") {
  const current = detail.current || {};
  const parts: string[] = [];
  const sourceTag = getObservationSourceTag(detail);

  if (current.obs_time) {
    const ageText =
      current.obs_age_min != null && current.obs_age_min >= 30
        ? isEnglish(locale)
          ? ` (${current.obs_age_min} min ago)`
          : `（${current.obs_age_min} 分钟前）`
        : "";
    parts.push(`✈️ ${sourceTag} ${current.obs_time}${ageText}`);
  }

  if (current.wx_desc) {
    const translated = translateMetar(current.wx_desc, locale);
    if (translated) {
      parts.push(`${translated.icon} ${translated.label}`);
    }
  } else if (current.cloud_desc) {
    const cloud = normalizeCloudSummary(current.cloud_desc, locale);
    parts.push(`${cloud.icon} ${cloud.text}`);
  }

  if (current.wind_speed_kt != null) {
    parts.push(`💨 ${current.wind_speed_kt}kt`);
  }

  if (current.visibility_mi != null) {
    parts.push(`👁️ ${current.visibility_mi}mi`);
  }

  if (detail.mgm?.temp != null) {
    const timeMatch = detail.mgm.time?.match(/T?(\d{2}:\d{2})/);
    const timeText = timeMatch ? ` @${timeMatch[1]}` : "";
    parts.push(
      isEnglish(locale)
        ? `🛰 MGM Obs: ${detail.mgm.temp}${detail.temp_symbol}${timeText}`
        : `🛰 MGM 实测: ${detail.mgm.temp}${detail.temp_symbol}${timeText}`,
    );
  }

  const trend = detail.trend || {};
  if (trend.is_dead_market) {
    parts.push(isEnglish(locale) ? "☠️ Flat market" : "☠️ 死盘");
  } else if (trend.direction && trend.direction !== "unknown") {
    const labels: Record<string, string> = isEnglish(locale)
      ? {
          falling: "📉 Cooling",
          mixed: "📊 Choppy",
          rising: "📈 Warming",
          stagnant: "⏸ Flat",
        }
      : {
          falling: "📉 降温中",
          mixed: "📊 波动中",
          rising: "📈 升温中",
          stagnant: "⏸ 持平",
        };
    parts.push(labels[trend.direction] || trend.direction);
  }

  return parts;
}

export function getTemperatureChartData(
  detail: CityDetail,
  locale: Locale = "zh-CN",
) {
  const hourly = detail.hourly || {};
  const times = hourly.times || [];
  const temps = hourly.temps || [];

  if (!times.length) return null;

  const currentHour = detail.local_time
    ? `${detail.local_time.split(":")[0]}:00`
    : null;
  const currentIndex = currentHour ? times.indexOf(currentHour) : -1;
  const omMax = detail.forecast?.today_high;
  const debMax = detail.deb?.prediction;
  const offset =
    debMax != null && omMax != null ? Number(debMax) - Number(omMax) : 0;
  const debTemps = temps.map((temp) =>
    temp != null ? Number((temp + offset).toFixed(1)) : null,
  );
  const debPast = debTemps.map((temp, index) =>
    currentIndex >= 0 && index <= currentIndex ? temp : null,
  );
  const debFuture = debTemps.map((temp, index) =>
    currentIndex < 0 || index >= currentIndex ? temp : null,
  );

  const observationTag = getObservationSourceTag(detail);
  const observationCode = getObservationSourceCode(detail);
  const settlementSource =
    observationCode === "hko" || observationCode === "cwa" || observationCode === "noaa";
  const officialObservationSource =
    settlementSource
      ? detail.settlement_today_obs?.length
        ? detail.settlement_today_obs
        : detail.current?.obs_time && detail.current?.temp != null
          ? [{ time: detail.current.obs_time, temp: detail.current.temp }]
          : []
      : [];
  const metarObservationSource = detail.metar_today_obs?.length
    ? detail.metar_today_obs
    : detail.trend?.recent || [];
  const allowMetarFallback =
    settlementSource && observationCode !== "hko";
  const shouldUseMetarFallback =
    allowMetarFallback &&
    officialObservationSource.length > 0 &&
    officialObservationSource.length < 3 &&
    metarObservationSource.length >= 3;
  const observationSource = settlementSource
    ? shouldUseMetarFallback
      ? metarObservationSource
      : officialObservationSource
    : metarObservationSource;
  const metarFallbackTag = (() => {
    const icao = String(detail.risk?.icao || "").trim().toUpperCase();
    if (!icao) return "METAR";
    return `${icao} METAR`;
  })();
  const observationDisplayTag =
    settlementSource && shouldUseMetarFallback
      ? metarFallbackTag
      : observationCode === "noaa"
        ? "NOAA RCTP"
        : observationTag;

  const metarPoints = new Array(times.length).fill(null);
  observationSource.forEach((item) => {
    const parts = String(item.time || "").split(":");
    let hour = Number.parseInt(parts[0], 10);
    if (Number.isNaN(hour)) return;
    const key = `${String(hour).padStart(2, "0")}:00`;
    const index = times.indexOf(key);
    const temp = item.temp ?? null;
    if (index >= 0 && temp != null) {
      const existing = metarPoints[index];
      // Multiple reports can land in the same hour bucket. Keep the peak
      // value so an intrahour high is not hidden by a later weaker report.
      metarPoints[index] =
        existing == null ? temp : Math.max(Number(existing), Number(temp));
    }
  });

  const mgmPoints = new Array(times.length).fill(null);
  if (detail.mgm?.temp != null && detail.mgm?.time) {
    const match = detail.mgm.time.match(/T?(\d{2}):(\d{2})/);
    if (match) {
      let hour = Number.parseInt(match[1], 10);
      const key = `${String(hour).padStart(2, "0")}:00`;
      const index = times.indexOf(key);
      if (index >= 0) {
        mgmPoints[index] = detail.mgm.temp;
      }
    }
  }

  const mgmHourlyPoints = new Array(times.length).fill(null);
  let hasMgmHourly = false;
  detail.mgm?.hourly?.forEach((item) => {
    const match = String(item.time || "").match(/T?(\d{2}):(\d{2})/);
    if (!match) return;
    const key = `${match[1]}:00`;
    const index = times.indexOf(key);
    if (index >= 0) {
      mgmHourlyPoints[index] = item.temp ?? null;
      hasMgmHourly = true;
    }
  });

  const allValues = [
    ...debTemps.filter((value) => value != null),
    ...metarPoints.filter((value) => value != null),
    ...mgmPoints.filter((value) => value != null),
    ...mgmHourlyPoints.filter((value) => value != null),
  ] as number[];

  if (!allValues.length) return null;

  const min = Math.floor(Math.min(...allValues)) - 1;
  const max = Math.ceil(Math.max(...allValues)) + 1;
  const tafMarkersRaw = Array.isArray(detail.taf?.signal?.markers)
    ? detail.taf?.signal?.markers || []
    : [];
  const tafMarkerValue = max - 0.4;
  const tafMarkerPoints = new Array(times.length).fill(null);
  const tafMarkers = tafMarkersRaw
    .map((marker) => {
      const labelTime = String(marker?.label_time || "").trim();
      const index = times.indexOf(labelTime);
      if (index >= 0) {
        tafMarkerPoints[index] = tafMarkerValue;
      }
      return {
        displayType: formatTafMarkerType(
          String(marker?.marker_type || "").trim(),
          locale,
        ),
        endLocal: String(marker?.end_local || "").trim(),
        index,
        labelTime,
        markerType: String(marker?.marker_type || "").trim(),
        startLocal: String(marker?.start_local || "").trim(),
        summary:
          isEnglish(locale)
            ? String(marker?.summary_en || "").trim()
            : String(marker?.summary_zh || "").trim(),
        suppressionLevel: String(marker?.suppression_level || "").trim(),
      };
    })
    .filter((marker) => marker.index >= 0);

  const legendParts: string[] = [];
  if (detail.mgm?.temp != null) {
    legendParts.push(`MGM: ${detail.mgm.temp}${detail.temp_symbol}`);
  }
  if (!hasMgmHourly && debMax != null && omMax != null && Math.abs(offset) > 0.3) {
    const sign = offset > 0 ? "+" : "";
    legendParts.push(
      isEnglish(locale)
        ? `DEB offset ${sign}${offset.toFixed(1)}${detail.temp_symbol} vs OM`
        : `DEB 偏移 ${sign}${offset.toFixed(1)}${detail.temp_symbol} vs OM`,
    );
  }
  if (hasMgmHourly) {
    legendParts.push(
      isEnglish(locale)
        ? "Using MGM hourly forecast to replace DEB curve"
        : "已使用 MGM 小时预报替代 DEB 曲线",
    );
  }
  if ((detail.trend?.recent?.length || 0) > 0 || observationSource.length > 0) {
    const recentData =
      observationSource.length > 0
        ? [...observationSource]
        : [...(detail.trend?.recent || [])];
    const recentText = recentData
      .slice(0, 4)
      .reverse()
      .map((item) => `${item.temp}${detail.temp_symbol}@${item.time}`)
      .join(" -> ");
    legendParts.push(`${observationDisplayTag}: ${recentText}`);
  }
  if (shouldUseMetarFallback) {
    legendParts.push(
      isEnglish(locale)
        ? `Official ${observationTag} feed is sparse today, so the continuous observation line switches to ${metarFallbackTag}.`
        : `今日官方 ${observationTag} 点位较稀疏，连续实测线改用 ${metarFallbackTag}。`,
    );
  } else if (observationCode === "hko") {
    legendParts.push(
      isEnglish(locale)
        ? "Hong Kong uses HKO official readings. The chart keeps official HKO points instead of switching to airport METAR."
        : "香港按 HKO 官方读数展示；图中保留 HKO 官方点位，不切换到机场 METAR 连续线。",
    );
  } else if (observationCode === "noaa") {
    legendParts.push(
      isEnglish(locale)
        ? "Taipei settles on NOAA RCTP using the finalized highest rounded whole-degree Celsius reading; the plotted line is a settlement reference."
        : "台北按 NOAA RCTP 最终完成质控后的最高整度摄氏值结算；图中曲线仅作为结算参考线。",
    );
  }
  if (tafMarkers.length) {
    const tafText = tafMarkers
      .slice(0, 4)
      .map((marker) => `${marker.displayType} ${marker.startLocal}-${marker.endLocal}`)
      .join(" | ");
    legendParts.push(
      isEnglish(locale)
        ? `TAF timing: ${tafText}`
        : `TAF 时段: ${tafText}`,
    );
  }

  return {
    datasets: {
      debFuture,
      debPast,
      hasMgmHourly,
      metarPoints,
      mgmHourlyPoints,
      mgmPoints,
      offset,
      tafMarkerPoints,
      temps,
    },
    observationLabel:
      observationCode === "noaa" && !shouldUseMetarFallback
        ? isEnglish(locale)
          ? `${observationDisplayTag} Settlement Reference`
          : `${observationDisplayTag} 结算参考`
        : isEnglish(locale)
          ? `${observationDisplayTag} Observation`
          : `${observationDisplayTag} 实况`,
    legendText: legendParts.join(" | "),
    max,
    min,
    tafMarkers,
    times,
  };
}

export function getProbabilityView(detail: CityDetail, targetDate?: string | null) {
  const date = targetDate || detail.local_date;
  if (date === detail.local_date) {
    return {
      mu: detail.probabilities?.mu ?? null,
      probabilities: detail.probabilities?.distribution || [],
    };
  }

  const daily = detail.multi_model_daily?.[date];
  return {
    mu: daily?.deb?.prediction ?? null,
    probabilities: daily?.probabilities || [],
  };
}

export function getModelView(detail: CityDetail, targetDate?: string | null) {
  const date = targetDate || detail.local_date;
  const daily = detail.multi_model_daily?.[date];
  if (daily) {
    return {
      deb: daily.deb?.prediction ?? null,
      models: daily.models || {},
    };
  }

  return {
    deb: detail.deb?.prediction ?? null,
    models: detail.multi_model || {},
  };
}

export function parseAiAnalysis(analysis: CityDetail["ai_analysis"]) {
  const fallback = {
    bullets: [] as string[],
    summary: "",
  };

  if (!analysis) return fallback;

  if (typeof analysis === "string") {
    return {
      bullets: [],
      summary: analysis.trim(),
    };
  }

  const structured = analysis as AiAnalysisStructured;
  return {
    bullets: Array.isArray(structured.highlights)
      ? structured.highlights
      : Array.isArray(structured.points)
        ? structured.points
        : [],
    summary: structured.summary || structured.text || structured.message || "",
  };
}

export function getAirportNarrative(
  detail: CityDetail,
  locale: Locale = "zh-CN",
) {
  const parsed = parseAiAnalysis(detail.ai_analysis);
  if (!isEnglish(locale)) return parsed;

  const englishSummary = containsCjk(parsed.summary) ? "" : parsed.summary.trim();
  const englishBullets = parsed.bullets
    .map((item) => String(item || "").trim())
    .filter((item) => item && !containsCjk(item));

  if (englishSummary || englishBullets.length > 0) {
    return {
      bullets: englishBullets,
      summary: englishSummary,
    };
  }

  const sourceLabel =
    String(detail.current?.settlement_source_label || "").trim() ||
    String(detail.risk?.icao || "").trim() ||
    String(detail.risk?.airport || "").trim() ||
    String(detail.display_name || detail.name || "").trim() ||
    "Airport";
  const currentTemp = Number(detail.current?.temp);
  const tempText = Number.isFinite(currentTemp)
    ? `${currentTemp}${detail.temp_symbol || "°C"}`
    : null;
  const obsTime = String(detail.current?.obs_time || "").trim();
  const weatherText = getWeatherSummary(detail, locale).weatherText.toLowerCase();
  const windBucket = bucketLabel(
    trendBucketFromDir(detail.current?.wind_dir ?? null),
    locale,
  );
  const windSpeedKt = Number(detail.current?.wind_speed_kt);
  const tafSummary = String(detail.taf?.signal?.summary_en || "").trim();
  const windPhrase = Number.isFinite(windSpeedKt)
    ? `${windBucket} around ${windSpeedKt} kt`
    : `${windBucket} prevailing`;
  const summaryParts = [
    tempText
      ? `${sourceLabel} reports ${tempText}${obsTime ? ` at ${obsTime}` : ""}, ${weatherText}.`
      : `${sourceLabel} reports ${weatherText}${obsTime ? ` at ${obsTime}` : ""}.`,
    `${windPhrase}.`,
    tafSummary,
  ].filter(Boolean);

  const bullets: string[] = [];
  const rawMetar = String(detail.current?.raw_metar || "").trim();
  if (rawMetar) {
    bullets.push(`Latest METAR: ${rawMetar}`);
  }
  if (tafSummary) {
    bullets.push(`TAF signal: ${tafSummary}`);
  }
  if (detail.taf?.raw_taf) {
    bullets.push(`TAF available for airport-side timing checks.`);
  }

  return {
    bullets,
    summary: summaryParts.join(" "),
  };
}

export function pickAnkaraNearbyStations(stations: NearbyStation[]) {
  const preferredNames = [
    "Airport (MGM/17128)",
    "Ankara (Bölge/Center)",
    "Ankara (Bolge/Center)",
    "Etimesgut",
    "Pursaklar",
    "Cubuk",
    "Çubuk",
    "Kalecik",
  ];

  const picks = preferredNames
    .map((name) => stations.find((station) => station?.name === name))
    .filter(Boolean) as NearbyStation[];

  return picks.length ? picks : stations;
}

export function getFutureSlice(detail: CityDetail, dateStr: string) {
  const hourly = detail.hourly_next_48h || {};
  const times = hourly.times || [];
  const slice: Array<{
    cloudCover: number | null;
    dewPoint: number | null;
    label: string;
    precipProb: number | null;
    pressure: number | null;
    radiation: number | null;
    temp: number | null;
    time: string;
    windDir: number | null;
    windSpeed: number | null;
  }> = [];

  for (let index = 0; index < times.length; index += 1) {
    const timestamp = times[index];
    if (!timestamp || !String(timestamp).startsWith(dateStr)) continue;

    slice.push({
      cloudCover: hourly.cloud_cover?.[index] ?? null,
      dewPoint: hourly.dew_point?.[index] ?? null,
      label: String(timestamp).split("T")[1]?.slice(0, 5) || timestamp,
      precipProb: hourly.precipitation_probability?.[index] ?? null,
      pressure: hourly.pressure_msl?.[index] ?? null,
      radiation: hourly.radiation?.[index] ?? null,
      temp: hourly.temps?.[index] ?? null,
      time: timestamp,
      windDir: hourly.wind_direction_10m?.[index] ?? null,
      windSpeed: hourly.wind_speed_10m?.[index] ?? null,
    });
  }

  return slice;
}

function trendBucketFromDir(direction?: number | null) {
  const value = Number(direction);
  if (!Number.isFinite(value)) return null;
  if (value >= 135 && value <= 240) return "southerly";
  if (value >= 290 || value <= 45) return "northerly";
  if (value > 45 && value < 135) return "easterly";
  return "westerly";
}

function bucketLabel(bucket: string | null, locale: Locale = "zh-CN") {
  if (isEnglish(locale)) {
    return (
      {
        southerly: "S / SW wind",
        northerly: "N / NW wind",
        easterly: "E wind",
        westerly: "W wind",
      }[bucket || ""] || "Unknown wind direction"
    );
  }
  return (
    {
      southerly: "南 / 西南风",
      northerly: "北 / 西北风",
      easterly: "东风",
      westerly: "西风",
    }[bucket || ""] || "风向不明"
  );
}

function formatTafMarkerType(type: string, locale: Locale = "zh-CN") {
  const normalized = String(type || "").trim().toUpperCase();
  if (isEnglish(locale)) {
    return (
      {
        BASE: "Base regime",
        FM: "Hard shift",
        TEMPO: "Temporary swing",
        BECMG: "Gradual shift",
        PROB30: "30% risk window",
        PROB40: "40% risk window",
        "PROB30 TEMPO": "30% temporary swing",
        "PROB40 TEMPO": "40% temporary swing",
      }[normalized] || normalized
    );
  }
  return (
    {
      BASE: "基础时段",
      FM: "明确切换",
      TEMPO: "临时波动",
      BECMG: "逐步转变",
      PROB30: "30% 风险窗",
      PROB40: "40% 风险窗",
      "PROB30 TEMPO": "30% 临时波动",
      "PROB40 TEMPO": "40% 临时波动",
    }[normalized] || normalized
  );
}

export function wuRound(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 0
    ? Math.floor(numeric + 0.5)
    : Math.ceil(numeric - 0.5);
}

export function formatDelta(value: number | null | undefined, suffix = "") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(1)}${suffix}`;
}

function getForecastTextForDate(detail: CityDetail, dateStr: string) {
  const periods = detail.source_forecasts?.weather_gov?.forecast_periods || [];
  return periods.filter((period) =>
    String(period.start_time || "").startsWith(dateStr),
  );
}

export function computeFrontTrendSignal(
  detail: CityDetail,
  dateStr: string,
  locale: Locale = "zh-CN",
) {
  const upperAirSignal = detail.vertical_profile_signal || {};
  const tafSignal = detail.taf?.signal || {};
  const upperAirTradeCue = upperAirSignal.source
    ? upperAirSignal.heating_setup === "supportive"
      ? {
          label: isEnglish(locale) ? "Trade cue" : "交易动作",
          note: isEnglish(locale)
            ? "Do not fade lower buckets too early."
            : "不宜过早做更低温区间。",
          tone: "warm",
          value: isEnglish(locale) ? "Lean warmer" : "偏暖侧",
        }
      : upperAirSignal.heating_setup === "suppressed"
        ? {
            label: isEnglish(locale) ? "Trade cue" : "交易动作",
            note: isEnglish(locale)
              ? "Be more careful chasing higher buckets."
              : "追更高温区间要更谨慎。",
            tone: "cold",
            value: isEnglish(locale) ? "Lean cautious" : "偏谨慎",
          }
        : {
            label: isEnglish(locale) ? "Trade cue" : "交易动作",
            note: isEnglish(locale)
              ? "Let surface structure and market price action decide first."
              : "先看近地面结构和盘口变化，不急着站边。",
            tone: "",
            value: isEnglish(locale) ? "Wait / confirm" : "先观察",
          }
    : null;
  const baseUpperAirSummary = upperAirSignal.source
    ? (() => {
        const hasMetrics =
          upperAirSignal.cape_max != null ||
          upperAirSignal.cin_min != null ||
          upperAirSignal.boundary_layer_height_max != null ||
          upperAirSignal.shear_10m_180m_max != null;
        if (!hasMetrics) {
          return isEnglish(locale)
            ? "Upper-air inputs are incomplete. For now, trade direction should rely more on surface structure."
            : "高空输入还不完整，当前交易方向先更多参考近地面结构信号。";
        }
        if (upperAirSignal.heating_setup === "supportive") {
          return isEnglish(locale)
            ? "Upper-air structure still favors further warming. Leaning too early against higher buckets is risky."
            : "高空结构仍偏向继续增温，过早去押更低温区间风险较高。";
        }
        if (upperAirSignal.heating_setup === "suppressed") {
          return isEnglish(locale)
            ? "Upper-air structure leans toward capping the afternoon high. Chasing higher buckets needs caution."
            : "高空结构更偏向压住午后峰值，追更高温区间要更谨慎。";
        }
        return isEnglish(locale)
          ? "Upper-air structure is fairly neutral. It does not give a clean edge by itself, so surface trends still decide the trade."
          : "高空结构整体偏中性，单看这层不给明确边，交易仍要让近地面走势来定。";
      })()
    : "";
  const tafSummary =
    tafSignal.available && dateStr === detail.local_date
      ? isEnglish(locale)
        ? String(tafSignal.summary_en || "").trim()
        : String(tafSignal.summary_zh || "").trim()
      : "";
  const upperAirSummary = [baseUpperAirSummary, tafSummary]
    .filter(Boolean)
    .join(isEnglish(locale) ? " " : "");
  const tafMetric =
    tafSignal.available && dateStr === detail.local_date
      ? {
          label: isEnglish(locale) ? "Airport TAF" : "机场预报",
          note: tafSummary ||
            (isEnglish(locale)
              ? "Airport TAF is available for the current peak window."
              : "当前峰值窗口已接入机场 TAF 预报。"),
          tone:
            tafSignal.suppression_level === "high"
              ? "cold"
              : tafSignal.suppression_level === "low"
                ? "warm"
                : "",
          value:
            tafSignal.suppression_level === "high"
              ? isEnglish(locale)
                ? "Suppression watch"
                : "防压温"
              : tafSignal.suppression_level === "medium"
                ? isEnglish(locale)
                  ? "Watch clouds/rain"
                  : "看云雨"
                : isEnglish(locale)
                  ? "Mostly stable"
                  : "暂稳",
        }
      : null;
  const upperAirMetrics = upperAirSignal.source
    ? [
        ...(upperAirTradeCue ? [upperAirTradeCue] : []),
        {
          label: isEnglish(locale) ? "Peak setup" : "冲高环境",
          note:
            upperAirSignal.heating_setup === "supportive"
              ? isEnglish(locale)
                ? "Still supportive of more daytime heating. Fading stronger buckets too early is risky."
                : "仍偏向白天继续冲高，过早去反着做更高温区间比较危险。"
              : upperAirSignal.heating_setup === "suppressed"
                ? isEnglish(locale)
                  ? "Leans toward capping the afternoon peak. Be careful chasing stronger buckets."
                  : "更偏向压住午后峰值，追更高温区间要谨慎。"
                : isEnglish(locale)
                  ? "Neutral on its own. Surface structure still decides the side."
                  : "单看这层偏中性，最终还是要看近地面信号站哪边。",
          tone:
            upperAirSignal.heating_setup === "supportive"
              ? "warm"
              : upperAirSignal.heating_setup === "suppressed"
                ? "cold"
                : "",
          value:
            upperAirSignal.heating_setup === "supportive"
              ? isEnglish(locale)
                ? "Supportive"
                : "偏支持"
              : upperAirSignal.heating_setup === "suppressed"
                ? isEnglish(locale)
                  ? "Suppressed"
                  : "偏压制"
                : isEnglish(locale)
                  ? "Neutral"
                  : "中性",
        },
        {
          label: isEnglish(locale) ? "Peak suppression risk" : "压温风险",
          note:
            upperAirSignal.cape_max != null || upperAirSignal.cin_min != null
              ? isEnglish(locale)
                ? `How likely clouds or showers are to cap the high. CAPE ${Math.round(Number(upperAirSignal.cape_max ?? 0))}, CIN ${Number(upperAirSignal.cin_min ?? 0).toFixed(0)}.`
                : `看云和阵雨有多大概率把峰值压住。CAPE ${Math.round(Number(upperAirSignal.cape_max ?? 0))}，CIN ${Number(upperAirSignal.cin_min ?? 0).toFixed(0)}。`
              : isEnglish(locale)
                ? "Estimated from the next 48h upper-air profile."
                : "根据未来 48 小时高空剖面估算。",
          tone:
            upperAirSignal.suppression_risk === "high"
              ? "cold"
              : upperAirSignal.suppression_risk === "low"
                ? "warm"
                : "",
          value:
            upperAirSignal.suppression_risk === "high"
              ? isEnglish(locale)
                ? "High"
                : "高"
              : upperAirSignal.suppression_risk === "medium"
                ? isEnglish(locale)
                  ? "Medium"
                  : "中"
                : isEnglish(locale)
                  ? "Low"
                  : "低",
        },
        {
          label: isEnglish(locale) ? "Afternoon disruption" : "午后扰动",
          note:
            upperAirSignal.lifted_index_min != null
              ? isEnglish(locale)
                ? `How easily the afternoon can turn noisy. Lifted Index ${Number(upperAirSignal.lifted_index_min).toFixed(1)}.`
                : `看午后是否容易突然起云、起对流，把走势搅乱。Lifted Index ${Number(upperAirSignal.lifted_index_min).toFixed(1)}。`
              : isEnglish(locale)
                ? "Uses instability and lifted-index structure."
                : "结合不稳定能量与抬升指数判断。",
          tone:
            upperAirSignal.trigger_risk === "high"
              ? "cold"
              : upperAirSignal.trigger_risk === "low"
                ? "warm"
                : "",
          value:
            upperAirSignal.trigger_risk === "high"
              ? isEnglish(locale)
                ? "High"
                : "高"
              : upperAirSignal.trigger_risk === "medium"
                ? isEnglish(locale)
                  ? "Medium"
                  : "中"
                : isEnglish(locale)
                  ? "Low"
                  : "低",
        },
        {
          label: isEnglish(locale) ? "Heating efficiency" : "冲高效率",
          note:
            upperAirSignal.boundary_layer_height_max != null
              ? isEnglish(locale)
                ? `How efficiently surface warmth can keep translating upward. Mixing depth peaks near ${Math.round(Number(upperAirSignal.boundary_layer_height_max))} m.`
                : `看地面热量能不能持续往上送，决定冲高效率。混合层高度峰值约 ${Math.round(Number(upperAirSignal.boundary_layer_height_max))} 米。`
              : isEnglish(locale)
                ? "Tracks daytime mixing depth."
                : "跟踪白天混合层深度。",
          tone:
            upperAirSignal.mixing_strength === "strong"
              ? "warm"
              : upperAirSignal.mixing_strength === "weak"
                ? "cold"
                : "",
          value:
            upperAirSignal.mixing_strength === "strong"
              ? isEnglish(locale)
                ? "Strong"
                : "强"
              : upperAirSignal.mixing_strength === "medium"
                ? isEnglish(locale)
                  ? "Medium"
                  : "中"
                : isEnglish(locale)
                ? "Weak"
                : "弱",
        },
        ...(tafMetric ? [tafMetric] : []),
      ]
    : tafMetric
      ? [tafMetric]
      : [];
  const rawBackendSummary =
    dateStr === detail.local_date
      ? String(detail.dynamic_commentary?.summary || "").trim()
      : "";
  const backendSummary =
    rawBackendSummary &&
    (!isEnglish(locale) || !containsCjk(rawBackendSummary))
      ? rawBackendSummary
      : "";
  const rawBackendNotes = Array.isArray(detail.dynamic_commentary?.notes)
    ? detail.dynamic_commentary?.notes
        ?.map((item) => String(item || "").trim())
        .filter(Boolean) || []
    : [];
  const backendNotes = rawBackendNotes.filter(
    (note) => !isEnglish(locale) || !containsCjk(note),
  );
  const slice = getFutureSlice(detail, dateStr);
  const currentTemp = Number(detail.current?.temp);
  const currentDew = Number(detail.current?.dewpoint);

  if (!slice.length) {
    return {
      confidence: "low",
      label: isEnglish(locale) ? "Monitoring" : "监控中",
      metrics: [] as Array<{
        label: string;
        note: string;
        tone?: string;
        value: string;
      }>,
      upperAirMetrics,
      upperAirSummary,
      precipMax: 0,
      score: 0,
      summary:
        backendSummary ||
        (isEnglish(locale)
          ? "Insufficient intraday structured data. Keep baseline monitoring."
          : "当日日内结构化数据不足，暂时只保留基础监控。"),
      weatherGovPeriods: [] as ReturnType<typeof getForecastTextForDate>,
    };
  }

  const normalizeHm = (value: unknown): string | null => {
    const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };
  const hmToMinutes = (value: string | null) => {
    if (!value) return null;
    const [hourPart, minutePart] = value.split(":");
    const hour = Number.parseInt(hourPart || "", 10);
    const minute = Number.parseInt(minutePart || "", 10);
    if (
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }
    return hour * 60 + minute;
  };
  const pointMinutes = (point: { label?: string }) =>
    hmToMinutes(normalizeHm(point.label));

  const isTargetToday = dateStr === detail.local_date;
  const currentHm = normalizeHm(detail.local_time);
  const sunsetHm = normalizeHm(detail.forecast?.sunset);
  const peakFirstHour = Number(detail.peak?.first_h);
  const peakLastHour = Number(detail.peak?.last_h);
  const hasPeakWindow =
    Number.isFinite(peakFirstHour) &&
    Number.isFinite(peakLastHour) &&
    peakFirstHour >= 0 &&
    peakLastHour >= peakFirstHour;
  const currentMinutes = hmToMinutes(currentHm);
  const sunsetMinutes = hmToMinutes(sunsetHm);
  const peakWindowStartMinutes = hasPeakWindow
    ? Math.max(0, (peakFirstHour - 2) * 60)
    : null;
  const peakWindowEndMinutes = hasPeakWindow
    ? Math.min(23 * 60 + 59, (peakLastHour + 1) * 60)
    : null;
  const canUseSunsetWindow =
    isTargetToday &&
    currentMinutes !== null &&
    sunsetMinutes !== null &&
    sunsetMinutes > currentMinutes;

  const futureSlice =
    isTargetToday && currentMinutes !== null
      ? slice.filter((point) => {
          const minutes = pointMinutes(point);
          return minutes === null ? true : minutes >= currentMinutes;
        })
      : slice;
  const untilSunsetSlice =
    canUseSunsetWindow && sunsetMinutes !== null
      ? futureSlice.filter((point) => {
          const minutes = pointMinutes(point);
          return minutes === null ? false : minutes <= sunsetMinutes;
        })
      : futureSlice;
  const aroundPeakSlice =
    isTargetToday &&
    peakWindowStartMinutes !== null &&
    peakWindowEndMinutes !== null
      ? futureSlice.filter((point) => {
          const minutes = pointMinutes(point);
          return minutes === null
            ? false
            : minutes >= peakWindowStartMinutes && minutes <= peakWindowEndMinutes;
        })
      : [];
  const workingSlice =
    aroundPeakSlice.length >= 2
      ? aroundPeakSlice
      : untilSunsetSlice.length >= 2
      ? untilSunsetSlice
      : futureSlice.length >= 2
        ? futureSlice
        : slice;
  const usingPeakWindow = aroundPeakSlice.length >= 2;
  const usingSunsetWindow = canUseSunsetWindow && untilSunsetSlice.length >= 2;
  const first = workingSlice[0] || slice[0];
  const last = workingSlice[workingSlice.length - 1] || slice[slice.length - 1];
  const effectiveHours = Math.max(1, workingSlice.length);
  const windowLabel = `${first?.label || "--"}-${last?.label || "--"}`;
  const windowText = isEnglish(locale)
    ? usingPeakWindow
      ? `today ${windowLabel} (~${effectiveHours}h, around peak window)`
      : usingSunsetWindow
      ? `today ${windowLabel} (~${effectiveHours}h, now -> sunset)`
      : isTargetToday
        ? `today ${windowLabel} (~${effectiveHours}h)`
        : `daily ${windowLabel} (~${effectiveHours}h)`
    : usingPeakWindow
      ? `今日 ${windowLabel}（约 ${effectiveHours} 小时，围绕峰值窗口）`
      : usingSunsetWindow
      ? `今日 ${windowLabel}（约 ${effectiveHours} 小时，当前至日落）`
      : isTargetToday
        ? `今日 ${windowLabel}（约 ${effectiveHours} 小时）`
        : `当日日内 ${windowLabel}（约 ${effectiveHours} 小时）`;
  const firstTemp = Number.isFinite(Number(first.temp)) ? Number(first.temp) : currentTemp;
  const lastTemp = Number.isFinite(Number(last.temp)) ? Number(last.temp) : firstTemp;
  const tempDelta =
    Number.isFinite(firstTemp) && Number.isFinite(lastTemp) ? lastTemp - firstTemp : 0;
  const firstDew = Number.isFinite(Number(first.dewPoint))
    ? Number(first.dewPoint)
    : currentDew;
  const lastDew = Number.isFinite(Number(last.dewPoint))
    ? Number(last.dewPoint)
    : firstDew;
  const dewDelta =
    Number.isFinite(firstDew) && Number.isFinite(lastDew) ? lastDew - firstDew : 0;
  const firstPressure = Number.isFinite(Number(first.pressure))
    ? Number(first.pressure)
    : null;
  const lastPressure = Number.isFinite(Number(last.pressure))
    ? Number(last.pressure)
    : firstPressure;
  const pressureDelta =
    Number.isFinite(Number(firstPressure)) && Number.isFinite(Number(lastPressure))
      ? Number(lastPressure) - Number(firstPressure)
      : 0;
  const firstCloud = Number.isFinite(Number(first.cloudCover))
    ? Number(first.cloudCover)
    : null;
  const lastCloud = Number.isFinite(Number(last.cloudCover))
    ? Number(last.cloudCover)
    : firstCloud;
  const cloudDelta =
    Number.isFinite(Number(firstCloud)) && Number.isFinite(Number(lastCloud))
      ? Number(lastCloud) - Number(firstCloud)
      : 0;
  const precipMax = slice.reduce(
    (max, point) => Math.max(max, Number(point.precipProb) || 0),
    0,
  );
  const firstBucket = trendBucketFromDir(first.windDir);
  const lastBucket = trendBucketFromDir(last.windDir);
  const weatherGovPeriods = getForecastTextForDate(detail, dateStr);
  const weatherGovText = weatherGovPeriods
    .map(
      (period) =>
        `${period.short_forecast || ""} ${period.detailed_forecast || ""}`.toLowerCase(),
    )
    .join(" ");

  let warmScore = 0;
  let coldScore = 0;
  if (tempDelta >= 2) warmScore += 24;
  else if (tempDelta >= 0.8) warmScore += 12;
  if (tempDelta <= -2) coldScore += 24;
  else if (tempDelta <= -0.8) coldScore += 12;
  if (dewDelta >= 1.2) warmScore += 14;
  if (dewDelta <= -1.2) coldScore += 10;
  if (pressureDelta >= 1.2) coldScore += 16;
  if (pressureDelta <= -1.0) warmScore += 8;
  if (lastBucket === "southerly") warmScore += 14;
  if (firstBucket !== lastBucket && lastBucket === "southerly") warmScore += 10;
  if (lastBucket === "northerly") coldScore += 14;
  if (firstBucket !== lastBucket && lastBucket === "northerly") coldScore += 10;
  if (cloudDelta >= 15 && tempDelta >= 0) warmScore += 6;
  if (cloudDelta >= 15 && tempDelta < 0) coldScore += 8;
  if (precipMax >= 40) coldScore += 8;
  if (
    weatherGovText.includes("cold front") ||
    weatherGovText.includes("temperatures falling")
  ) {
    coldScore += 18;
  }
  if (weatherGovText.includes("warm front") || weatherGovText.includes("warmer")) {
    warmScore += 18;
  }
  if (weatherGovText.includes("thunder") || weatherGovText.includes("snow")) {
    coldScore += 8;
  }

  const score = Math.max(-100, Math.min(100, warmScore - coldScore));
  const warmLabel = isEnglish(locale) ? "Near-term warming bias" : "未来偏升温";
  const coldLabel = isEnglish(locale) ? "Near-term cooling bias" : "未来偏降温";
  const monitorLabel = isEnglish(locale) ? "Direction unclear" : "方向不清";
  const label = score >= 18 ? warmLabel : score <= -18 ? coldLabel : monitorLabel;
  const confidence =
    Math.abs(score) >= 45 ? "high" : Math.abs(score) >= 22 ? "medium" : "low";
  const directionalLead = (() => {
    if (isEnglish(locale)) {
      if (score >= 18 && tempDelta >= 0.5) {
        return `Over ${windowText}, temperatures still lean warmer.`;
      }
      if (score <= -18 && tempDelta <= -0.5) {
        return `Over ${windowText}, temperatures still lean cooler.`;
      }
      if (score >= 18) {
        return `Over ${windowText}, the structure still leans warmer, but the warming pace is not strong yet.`;
      }
      if (score <= -18) {
        return `Over ${windowText}, the structure still leans cooler, but the cooling pace is not decisive yet.`;
      }
      if (tempDelta >= 0.8) {
        return `Over ${windowText}, temperatures still lean warmer, but confidence is limited.`;
      }
      if (tempDelta <= -0.8) {
        return `Over ${windowText}, temperatures still lean cooler, but confidence is limited.`;
      }
      return `Over ${windowText}, temperatures are more likely to stay range-bound for now.`;
    }

    if (score >= 18 && tempDelta >= 0.5) {
      return `${windowText}偏增温，后续更可能继续往上走。`;
    }
    if (score <= -18 && tempDelta <= -0.5) {
      return `${windowText}偏降温，后续更可能继续往下走。`;
    }
    if (score >= 18) {
      return `${windowText}仍偏增温，但增温兑现力度暂时不算强。`;
    }
    if (score <= -18) {
      return `${windowText}仍偏降温，但降温兑现力度暂时不算强。`;
    }
    if (tempDelta >= 0.8) {
      return `${windowText}略偏增温，但结构信号置信度有限。`;
    }
    if (tempDelta <= -0.8) {
      return `${windowText}略偏降温，但结构信号置信度有限。`;
    }
    return `${windowText}更像震荡整理，短时升降温方向暂不清晰。`;
  })();
  const summary = (() => {
    const parts: string[] = [];

    if (isEnglish(locale)) {
      parts.push(directionalLead);

      if (lastBucket === "southerly" && firstBucket !== "southerly") {
        parts.push("Low-level wind turns more southerly.");
      } else if (lastBucket === "northerly" && firstBucket !== "northerly") {
        parts.push("Low-level wind shifts toward a northerly regime.");
      }

      if (tempDelta >= 0.8) {
        parts.push(`Temperature rises by ${formatDelta(tempDelta, detail.temp_symbol)}.`);
      } else if (tempDelta <= -0.8) {
        parts.push(`Temperature eases by ${formatDelta(tempDelta, detail.temp_symbol)}.`);
      }

      if (dewDelta >= 0.8) {
        parts.push("Dew point is lifting, suggesting moisture transport is strengthening.");
      } else if (dewDelta <= -0.8) {
        parts.push("Dew point is falling, so low-level air is turning drier.");
      }

      if (cloudDelta >= 15) {
        parts.push("Cloud cover is building.");
      } else if (cloudDelta <= -15) {
        parts.push("Cloud cover is easing.");
      }

      if (pressureDelta >= 1) {
        parts.push("Pressure rebound argues for a cooler push.");
      } else if (pressureDelta <= -1) {
        parts.push("Pressure is softening, which is less hostile to warming.");
      }

      if (precipMax >= 50) {
        parts.push("Precipitation risk is high enough to watch for cloud/rain suppression.");
      }

      if (!parts.length) {
        parts.push(`Structured trend is mixed, so the core judgement still centers on ${windowText}.`);
      } else {
        parts.push(`Core judgement remains focused on ${windowText}.`);
      }
    } else {
      parts.push(directionalLead);

      if (lastBucket === "southerly" && firstBucket !== "southerly") {
        parts.push("低层风向更偏南，暖空气输送权重上升。");
      } else if (lastBucket === "northerly" && firstBucket !== "northerly") {
        parts.push("低层风向转偏北，冷空气影响权重上升。");
      }

      if (tempDelta >= 0.8) {
        parts.push(`气温抬升 ${formatDelta(tempDelta, detail.temp_symbol)}。`);
      } else if (tempDelta <= -0.8) {
        parts.push(`气温回落 ${formatDelta(tempDelta, detail.temp_symbol)}。`);
      }

      if (dewDelta >= 0.8) {
        parts.push("露点同步上升，说明暖湿输送在增强。");
      } else if (dewDelta <= -0.8) {
        parts.push("露点回落，低层空气在转干。");
      }

      if (cloudDelta >= 15) {
        parts.push("云量正在增多。");
      } else if (cloudDelta <= -15) {
        parts.push("云量正在回落。");
      }

      if (pressureDelta >= 1) {
        parts.push("气压回升，更偏向冷空气压入。");
      } else if (pressureDelta <= -1) {
        parts.push("气压走低，对增温压制减弱。");
      }

      if (precipMax >= 50) {
        parts.push("降水概率已足以关注云雨压温。");
      }

      if (!parts.length) {
        parts.push(`结构信号分化较大，核心仍围绕${windowText}观察。`);
      } else {
        parts.push(`核心判断窗口仍以${windowText}为主。`);
      }
    }

    return parts.join(isEnglish(locale) ? " " : "");
  })();
  const tafContrastSummary =
    tafSignal.available && dateStr === detail.local_date
      ? (() => {
          const tafSuppression = String(
            tafSignal.suppression_level || "low",
          ).toLowerCase();
          const isCoolingBias = score <= -18;
          const isWarmingBias = score >= 18;

          if (tafSuppression === "low" && isCoolingBias) {
            return isEnglish(locale)
              ? "TAF is not adding a new cloud/rain suppression signal, but the near-surface window is already leaning cooler, so the current cooling bias still comes mainly from surface structure."
              : "TAF 没有新增云雨压温利空，但当前峰值窗口里的近地面结构已经偏弱，所以这次偏降温判断仍主要来自近地面信号。";
          }
          if (tafSuppression === "low" && isWarmingBias) {
            return isEnglish(locale)
              ? "TAF is not adding a new cloud/rain cap, and the warmer bias still comes mainly from the surface window."
              : "TAF 没有新增云雨压温约束，当前偏升温判断仍主要来自近地面窗口。";
          }
          if (tafSuppression === "medium" && isCoolingBias) {
            return isEnglish(locale)
              ? "TAF is not the only driver here; it only reinforces part of the cooling-side case, while the main tilt still comes from the surface window."
              : "这次偏降温不只是 TAF 在起作用；TAF 只是加强了部分冷侧判断，主方向仍来自近地面窗口。";
          }
          return "";
        })()
      : "";
  const backendSupplement =
    backendSummary && backendSummary !== summary ? backendSummary : "";
  const combinedSummary = [summary, tafSummary, tafContrastSummary, backendSupplement]
    .filter(Boolean)
    .join(isEnglish(locale) ? " " : "");
  const cloudNote = (() => {
    if (cloudDelta >= 15 && tempDelta >= 0.8 && dewDelta >= 0.8) {
      return isEnglish(locale)
        ? "Clouds are increasing while temperature and dew point still rise; this usually fits ongoing warm-moist transport rather than immediate cooling."
        : "云量上升时温度和露点仍在抬升，更像暖湿输送持续中，而不是立刻转凉。";
    }
    if (cloudDelta >= 15 && tempDelta >= 0 && lastBucket === "southerly") {
      return isEnglish(locale)
        ? "Clouds are building without clear cooling, and the low-level wind still leans southerly; watch for warm advection to continue."
        : "云量增多但未明显降温，且低层风仍偏南，需继续关注暖平流是否延续。";
    }
    if (cloudDelta >= 15 && tempDelta < 0 && precipMax >= 40) {
      return isEnglish(locale)
        ? "Clouds are thickening while temperature eases and precipitation risk is elevated; cloud/rain suppression is becoming more likely."
        : "云量增厚且气温回落，同时降水概率偏高，更像云雨压温开始生效。";
    }
    if (cloudDelta >= 15 && tempDelta < 0 && pressureDelta >= 1) {
      return isEnglish(locale)
        ? "Clouds are increasing while temperature softens and pressure rebounds; watch for cold-air push or frontal suppression."
        : "云量上升同时气温走弱、气压回升，需留意冷空气压入或锋面压温。";
    }
    if (cloudDelta <= -15 && tempDelta >= 0.8) {
      return isEnglish(locale)
        ? "Cloud cover is easing while temperature rises; daytime heating efficiency is improving."
        : "云量回落且温度抬升，白天增温效率在改善。";
    }
    return isEnglish(locale)
      ? "Read cloud-cover change together with temperature, dew point, wind, and precipitation; cloud change alone does not define the regime."
      : "云量变化需要结合温度、露点、风向和降水一起看，不能单独决定天气形势。";
  })();
  const dewNote = (() => {
    if (dewDelta >= 1.2 && tempDelta >= 0.8) {
      return isEnglish(locale)
        ? "Dew point and temperature rise together, which usually supports strengthening warm-moist transport."
        : "露点和温度同步抬升，更偏向暖湿输送增强。";
    }
    if (dewDelta >= 1.2 && precipMax >= 40) {
      return isEnglish(locale)
        ? "Moisture is building while precipitation risk is already notable; watch for showers to cap daytime heating."
        : "水汽在累积且降水风险已抬升，需关注阵雨对午后增温的压制。";
    }
    if (dewDelta <= -1.2 && tempDelta <= 0) {
      return isEnglish(locale)
        ? "Drier low-level air is arriving together with softer temperature, which leans away from warm-moist support."
        : "低层空气在转干且温度偏弱，暖湿支撑正在减弱。";
    }
    return isEnglish(locale)
      ? "Use dew-point change to judge whether low-level warm-moist transport is strengthening or fading."
      : "露点变化主要用于判断低层暖湿输送是在增强还是减弱。";
  })();
  const pressureNote = (() => {
    if (pressureDelta >= 1.2 && tempDelta <= -0.8) {
      return isEnglish(locale)
        ? "Pressure rebound with cooling usually points to a cooler push or frontal suppression."
        : "气压回升且温度走弱，更像冷空气压入或锋面压温。";
    }
    if (pressureDelta <= -1.0 && tempDelta >= 0.8) {
      return isEnglish(locale)
        ? "Pressure is softening while temperature rises, a setup less hostile to warming."
        : "气压走低同时温度抬升，对增温的压制相对减弱。";
    }
    return isEnglish(locale)
      ? "Pressure change is used as a supporting signal for cold-air push versus warming resilience."
      : "气压变化更适合作为冷空气压入或增温韧性的辅助判断。";
  })();
  const windNote = (() => {
    if (firstBucket !== lastBucket && lastBucket === "southerly") {
      return isEnglish(locale)
        ? "Wind turns toward a southerly regime, which is more favorable for warming."
        : "风向转偏南，更有利于增温。";
    }
    if (firstBucket !== lastBucket && lastBucket === "northerly") {
      return isEnglish(locale)
        ? "Wind turns toward a northerly regime, which is more favorable for cooling."
        : "风向转偏北，更有利于降温。";
    }
    if (lastBucket === "southerly") {
      return isEnglish(locale)
        ? "Low-level flow remains southerly, so warm advection has not been disrupted."
        : "低层风维持偏南，暖平流支撑尚未被破坏。";
    }
    if (lastBucket === "northerly") {
      return isEnglish(locale)
        ? "Low-level flow remains northerly, so cooling-side support is still present."
        : "低层风维持偏北，降温侧支撑仍在。";
    }
    return isEnglish(locale)
      ? "Wind-direction change matters most when it crosses into southerly or northerly buckets."
      : "风向变化最关键的是是否跨入偏南或偏北风桶。";
  })();
  const precipNote = (() => {
    if (precipMax >= 60) {
      return isEnglish(locale)
        ? "Precipitation risk is high enough that cloud/rain suppression can materially change the peak outcome."
        : "降水概率已高到足以显著改变峰值兑现结果，需要重点防压温。";
    }
    if (precipMax >= 40) {
      return isEnglish(locale)
        ? "Precipitation risk is meaningful; watch whether cloud and showers interrupt daytime heating."
        : "降水概率已有存在感，需要关注云系和阵雨是否打断白天增温。";
    }
    return isEnglish(locale)
      ? "Precipitation risk remains limited and is used mainly as a suppression check."
      : "降水风险暂时有限，主要作为压温风险校验项。";
  })();

  const metrics = [
    {
      label: isEnglish(locale) ? "Temperature delta" : "温度变化",
      note: isEnglish(locale)
        ? `Official Open-Meteo hourly data; window: ${windowText}`
        : `官方 Open-Meteo 小时数据；计算窗口：${windowText}`,
      tone: tempDelta >= 0.8 ? "warm" : tempDelta <= -0.8 ? "cold" : "",
      value: formatDelta(tempDelta, detail.temp_symbol),
    },
    {
      label: isEnglish(locale) ? "Dew point delta" : "露点变化",
      note: dewNote,
      tone: dewDelta >= 0.8 ? "warm" : dewDelta <= -0.8 ? "cold" : "",
      value: formatDelta(dewDelta, detail.temp_symbol),
    },
    {
      label: isEnglish(locale) ? "Pressure delta" : "气压变化",
      note: pressureNote,
      tone: pressureDelta >= 1 ? "cold" : pressureDelta <= -1 ? "warm" : "",
      value: formatDelta(pressureDelta, " hPa"),
    },
    {
      label: isEnglish(locale) ? "Wind-direction evolution" : "风向演变",
      note: windNote,
      value: `${bucketLabel(firstBucket, locale)} -> ${bucketLabel(lastBucket, locale)}`,
    },
    {
      label: isEnglish(locale) ? "Precip probability" : "降水概率",
      note: precipNote,
      tone: precipMax >= 50 ? "cold" : "",
      value: `${Math.round(precipMax)}%`,
    },
    {
      label: isEnglish(locale) ? "Cloud-cover delta" : "云量变化",
      note: cloudNote,
      tone:
        cloudDelta >= 15 && tempDelta >= 0
          ? "warm"
          : cloudDelta >= 15 && tempDelta < 0
            ? "cold"
            : "",
      value: formatDelta(cloudDelta, "%"),
    },
  ];

  if (backendNotes.length) {
    const normalizedSummary = backendSummary.trim();
    const alignedNotes = backendNotes.filter(
      (note) => String(note || "").trim() !== normalizedSummary,
    );
    alignedNotes.slice(0, metrics.length).forEach((note, index) => {
      if (!note) return;
      metrics[index] = {
        ...metrics[index],
        note,
      };
    });
  }

  return {
    confidence,
    label,
    metrics,
    upperAirMetrics,
    upperAirSummary,
    precipMax,
    score,
    summary: combinedSummary || backendSummary || summary,
    weatherGovPeriods,
  };
}

export function getFutureModalView(
  detail: CityDetail,
  dateStr: string,
  locale: Locale = "zh-CN",
) {
  const forecastEntry =
    detail.forecast?.daily?.find((item) => item.date === dateStr) || null;
  const dailyModel = detail.multi_model_daily?.[dateStr] || {};
  const probabilities = dailyModel.probabilities || [];
  const totalProbability = probabilities.reduce((sum, item) => {
    const probability = Number(item.probability);
    return Number.isFinite(probability) ? sum + probability : sum;
  }, 0);
  const weightedProbability = probabilities.reduce((sum, item) => {
    const value = Number(item.value);
    const probability = Number(item.probability);
    if (!Number.isFinite(value) || !Number.isFinite(probability)) {
      return sum;
    }
    return sum + value * probability;
  }, 0);
  const mu = totalProbability > 0 ? weightedProbability / totalProbability : null;
  const deb = dailyModel.deb?.prediction ?? forecastEntry?.max_temp ?? null;

  return {
    deb,
    forecastEntry,
    front: computeFrontTrendSignal(detail, dateStr, locale),
    models: dailyModel.models || {},
    mu: Number.isFinite(Number(mu)) ? Number(mu) : null,
    probabilities,
    slice: getFutureSlice(detail, dateStr),
  };
}

export function getShortTermNowcastLines(
  detail: CityDetail,
  dateStr: string,
  locale: Locale = "zh-CN",
) {
  const slice = getFutureSlice(detail, dateStr);
  if (dateStr !== detail.local_date) {
    const afternoon = slice.filter((point) => {
      const hour = Number.parseInt(String(point.label).split(":")[0], 10);
      return Number.isFinite(hour) && hour >= 12 && hour <= 18;
    });
    const target = afternoon.length ? afternoon : slice;
    if (!target.length) {
      return [
        [isEnglish(locale) ? "Target date" : "目标日期", dateStr],
        [
          isEnglish(locale) ? "Peak window" : "峰值窗口",
          isEnglish(locale)
            ? "No sufficient hourly forecast data for target-day peak-window diagnostics."
            : "暂无足够的小时级 forecast 数据，无法生成目标日午后峰值窗口判断。",
        ],
      ] as const;
    }

    const maxIndex = target.reduce((bestIndex, point, index, array) => {
      const temp = Number(point.temp);
      const bestTemp = Number(array[bestIndex]?.temp);
      if (!Number.isFinite(temp)) return bestIndex;
      if (!Number.isFinite(bestTemp) || temp > bestTemp) return index;
      return bestIndex;
    }, 0);

    const peakSlice = target.slice(
      Math.max(0, maxIndex - 1),
      Math.min(target.length, maxIndex + 2),
    );
    const start = peakSlice[0];
    const end = peakSlice[peakSlice.length - 1];
    const peakPoint = target[maxIndex] || end;
    const startTemp = Number(start.temp);
    const endTemp = Number(end.temp);
    const startDew = Number(start.dewPoint);
    const endDew = Number(end.dewPoint);
    const startPressure = Number(start.pressure);
    const endPressure = Number(end.pressure);
    const precipValues = peakSlice
      .map((point) => Number(point.precipProb))
      .filter(Number.isFinite);
    const cloudValues = peakSlice
      .map((point) => Number(point.cloudCover))
      .filter(Number.isFinite);
    const maxPrecip = precipValues.length ? Math.max(...precipValues) : 0;
    const maxCloud = cloudValues.length ? Math.max(...cloudValues) : 0;

    return [
      [isEnglish(locale) ? "Target date" : "目标日期", dateStr],
      [
        isEnglish(locale) ? "Peak window" : "峰值窗口",
        isEnglish(locale)
          ? `${start.label} - ${end.label} (prefer 12:00-18:00)`
          : `${start.label} - ${end.label}（优先取 12:00-18:00）`,
      ],
      [
        isEnglish(locale) ? "Peak estimate" : "峰值预估",
        `${Number.isFinite(Number(peakPoint.temp)) ? Number(peakPoint.temp).toFixed(1) : "--"}${detail.temp_symbol} @ ${peakPoint.label || "--"}`,
      ],
      [
        isEnglish(locale) ? "Window temperature" : "窗口温度",
        `${Number.isFinite(startTemp) ? startTemp.toFixed(1) : "--"}${detail.temp_symbol} -> ${Number.isFinite(endTemp) ? endTemp.toFixed(1) : "--"}${detail.temp_symbol} (${formatDelta(endTemp - startTemp, detail.temp_symbol)})`,
      ],
      [
        isEnglish(locale) ? "Dew-point delta" : "露点变化",
        isEnglish(locale)
          ? `${formatDelta(endDew - startDew, detail.temp_symbol)} for diagnosing warm/wet transport in afternoon.`
          : `${formatDelta(endDew - startDew, detail.temp_symbol)}，用于判断午后暖湿输送是否增强。`,
      ],
      [
        isEnglish(locale) ? "Wind shift" : "风向演变",
        isEnglish(locale)
          ? `${bucketLabel(trendBucketFromDir(start.windDir), locale)} -> ${bucketLabel(trendBucketFromDir(end.windDir), locale)} around peak window.`
          : `${bucketLabel(trendBucketFromDir(start.windDir), locale)} -> ${bucketLabel(trendBucketFromDir(end.windDir), locale)}，关注峰值前后是否转南风或回摆北风。`,
      ],
      [
        isEnglish(locale) ? "Pressure delta" : "气压变化",
        isEnglish(locale)
          ? `${formatDelta(endPressure - startPressure, " hPa")} (higher pressure usually favors cold-air push).`
          : `${formatDelta(endPressure - startPressure, " hPa")}，上升更偏向冷空气压入。`,
      ],
      [
        isEnglish(locale) ? "Precip / cloud" : "降水 / 云量",
        isEnglish(locale)
          ? `${Math.round(maxPrecip)}% / ${Math.round(maxCloud)}% for cloud-suppression judgement around peak hours.`
          : `${Math.round(maxPrecip)}% / ${Math.round(maxCloud)}%，用于判断峰值时段是否受云系压制。`,
      ],
    ] as const;
  }

  const recent = Array.isArray(detail.metar_recent_obs)
    ? detail.metar_recent_obs.slice(-4)
    : [];
  const nearby = Array.isArray(detail.mgm_nearby) ? detail.mgm_nearby : [];
  const nearbySource = String(detail.nearby_source || "").toLowerCase();
  const sourceLabel =
    nearbySource === "mgm" || detail.name === "ankara"
      ? isEnglish(locale)
        ? "MGM nearby stations"
        : "MGM 周边站"
      : nearbySource === "official_cluster"
        ? isEnglish(locale)
          ? "Official nearby stations"
          : "官方周边站"
      : isEnglish(locale)
        ? "METAR nearby stations"
        : "METAR 周边站";
  const currentTemp = Number(detail.current?.temp);
  const recentTemps = recent
    .map((point) => Number(point.temp))
    .filter((value) => Number.isFinite(value));
  const baseline = recentTemps.length ? recentTemps[0] : currentTemp;
  const shortDelta =
    Number.isFinite(currentTemp) && Number.isFinite(baseline)
      ? currentTemp - baseline
      : 0;
  let nearbyLead: { diff: number; name: string; temp: number } | null = null;

  for (const station of nearby) {
    const temp = Number(station.temp);
    if (!Number.isFinite(temp) || !Number.isFinite(currentTemp)) continue;
    const diff = temp - currentTemp;
    if (!nearbyLead || Math.abs(diff) > Math.abs(nearbyLead.diff)) {
      nearbyLead = {
        diff,
        name:
          station.name ||
          station.icao ||
          (isEnglish(locale) ? "Nearby station" : "周边站"),
        temp,
      };
    }
  }

  const rows: Array<readonly [string, string]> = [
    [
      isEnglish(locale) ? "Primary station" : "当前主站",
      `${detail.current?.temp ?? "--"}${detail.temp_symbol} @ ${detail.current?.obs_time || "--"}`,
    ],
    [
      isEnglish(locale) ? "Raw METAR" : "原始 METAR",
      detail.current?.raw_metar || (isEnglish(locale) ? "N/A" : "暂无"),
    ],
    [
      isEnglish(locale) ? "Next 0-2h" : "近 0-2 小时",
      isEnglish(locale)
        ? `${formatDelta(shortDelta, detail.temp_symbol)} based on latest METAR sequence short-term momentum.`
        : `${formatDelta(shortDelta, detail.temp_symbol)}，依据最近 METAR 序列判断短时动量。`,
    ],
    [
      sourceLabel,
      isEnglish(locale)
        ? `${nearby.length} stations joined the nearby scan.`
        : `${nearby.length} 个站点参与邻近监控。`,
    ],
  ];

  if (nearbyLead) {
    const tone = isEnglish(locale)
      ? nearbyLead.diff > 0
        ? "warmer"
        : nearbyLead.diff < 0
          ? "cooler"
          : "flat"
      : nearbyLead.diff > 0
        ? "偏暖"
        : nearbyLead.diff < 0
          ? "偏冷"
          : "持平";
    rows.push([
      isEnglish(locale) ? "Leading station" : "领先站",
      isEnglish(locale)
        ? `${nearbyLead.name} ${nearbyLead.temp}${detail.temp_symbol}, relative to primary station ${formatDelta(nearbyLead.diff, detail.temp_symbol)} (${tone}).`
        : `${nearbyLead.name} ${nearbyLead.temp}${detail.temp_symbol}，相对主站 ${formatDelta(nearbyLead.diff, detail.temp_symbol)}（${tone}）。`,
    ]);
  }

  return rows;
}

export function getHistorySummary(
  history: HistoryPoint[],
  cityLocalDate?: string | null,
) {
  const toFinite = (value: unknown): number | null => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const isExcludedModel = (name: string) =>
    String(name || "").toLowerCase().includes("meteoblue");

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 14);

  const recentData = history.filter((row) => {
    if (!row?.date) return false;
    const rowDate = new Date(`${row.date}T00:00:00`);
    return !Number.isNaN(rowDate.getTime()) && rowDate >= cutoff;
  });

  const settledData = recentData.filter((row) => {
    if (!row?.date) return false;
    return cityLocalDate
      ? row.date < cityLocalDate
      : row.date < new Date().toISOString().slice(0, 10);
  });
  const comparableSettledData = settledData.filter((row) => {
    const actual = toFinite(row.actual);
    const deb = toFinite(row.deb);
    return actual != null && deb != null;
  });

  let hits = 0;
  const debErrors: number[] = [];
  const modelErrors: Record<string, number[]> = {};

  comparableSettledData.forEach((row) => {
    const actual = toFinite(row.actual);
    const deb = toFinite(row.deb);
    if (actual == null || deb == null) return;
    debErrors.push(Math.abs(actual - deb));
    if (wuRound(actual) === wuRound(deb)) {
      hits += 1;
    }

    const forecasts = row.forecasts || {};
    Object.entries(forecasts).forEach(([modelName, modelValue]) => {
      if (isExcludedModel(modelName)) return;
      const mv = toFinite(modelValue);
      if (actual == null || mv == null) return;
      if (!modelErrors[modelName]) {
        modelErrors[modelName] = [];
      }
      modelErrors[modelName].push(Math.abs(actual - mv));
    });
  });

  const modelMaeList = Object.entries(modelErrors)
    .map(([name, errors]) => ({
      mae:
        errors.length > 0
          ? errors.reduce((sum, value) => sum + value, 0) / errors.length
          : Number.POSITIVE_INFINITY,
      model: name,
      sampleCount: errors.length,
    }))
    .filter((row) => Number.isFinite(row.mae) && row.sampleCount > 0)
    .sort((a, b) => a.mae - b.mae);

  const primaryModelMaeList = modelMaeList.filter((row) => row.sampleCount >= 2);
  const bestModel = (primaryModelMaeList[0] || modelMaeList[0]) ?? null;
  const bestModelName = bestModel?.model || null;
  const bestModelMae = bestModel ? Number(bestModel.mae.toFixed(1)) : null;
  const bestModelSeries = recentData.map((row) =>
    bestModelName ? toFinite(row.forecasts?.[bestModelName]) : null,
  );

  let debWinDaysVsBest = 0;
  let debVsBestComparableDays = 0;
  if (bestModelName) {
    comparableSettledData.forEach((row) => {
      const actual = toFinite(row.actual);
      const deb = toFinite(row.deb);
      const bestModelVal = toFinite(row.forecasts?.[bestModelName]);
      if (actual == null || deb == null || bestModelVal == null) return;
      debVsBestComparableDays += 1;
      if (Math.abs(deb - actual) <= Math.abs(bestModelVal - actual)) {
        debWinDaysVsBest += 1;
      }
    });
  }

  return {
    dates: recentData.map((row) => row.date),
    debMae: debErrors.length
      ? Number(
          (
            debErrors.reduce((sum, value) => sum + value, 0) / debErrors.length
          ).toFixed(1),
        )
      : null,
    debs: recentData.map((row) => row.deb),
    bestModelName,
    bestModelMae,
    bestModelSeries,
    modelMaeRanks: modelMaeList.map((row) => ({
      model: row.model,
      mae: Number(row.mae.toFixed(1)),
      sampleCount: row.sampleCount,
    })),
    debWinDaysVsBest,
    debVsBestComparableDays,
    debWinRateVsBest:
      debVsBestComparableDays > 0
        ? Number(((debWinDaysVsBest / debVsBestComparableDays) * 100).toFixed(0))
        : null,
    hitRate: debErrors.length
      ? Number(((hits / debErrors.length) * 100).toFixed(0))
      : null,
    mgms: recentData.map((row) => row.mgm ?? null),
    recentData,
    settledCount: comparableSettledData.length,
    actuals: recentData.map((row) => row.actual),
  };
}

export function getCityProfileStats(detail: CityDetail, locale: Locale = "zh-CN") {
  const risk = detail.risk || {};
  const current = detail.current || {};
  const nearbyCount = Array.isArray(detail.mgm_nearby) ? detail.mgm_nearby.length : 0;
  const sourceCode = getObservationSourceCode(detail);
  const isOfficialSource = sourceCode === "hko" || sourceCode === "cwa" || sourceCode === "noaa";

  const sourceDisplay = (() => {
    if (sourceCode === "hko") {
      return isEnglish(locale)
        ? "Hong Kong Observatory (HKO)"
        : "香港天文台 (HKO)";
    }
    if (sourceCode === "cwa") {
      return isEnglish(locale)
        ? "Central Weather Administration (CWA)"
        : "交通部中央气象署 (CWA)";
    }
    if (sourceCode === "noaa") {
      return isEnglish(locale)
        ? "NOAA RCTP (Taiwan Taoyuan)"
        : "NOAA RCTP（台湾桃园国际机场）";
    }
    const tag = getObservationSourceTag(detail);
    if (sourceCode === "mgm") {
      return isEnglish(locale) ? `MGM (${tag})` : `MGM (${tag})`;
    }
    if (risk.airport && risk.icao) return `${risk.airport} (${risk.icao})`;
    if (risk.airport) return String(risk.airport);
    return isEnglish(locale) ? "No profile" : "暂无档案";
  })();

  return [
    {
      label: isOfficialSource
        ? isEnglish(locale)
          ? "Settlement source"
          : "结算源"
        : isEnglish(locale)
          ? "Settlement airport"
          : "结算机场",
      value: sourceDisplay,
    },
    {
      label: isOfficialSource
        ? isEnglish(locale)
          ? "Reference distance"
          : "参考距离"
        : isEnglish(locale)
          ? "Station distance"
          : "站点距离",
      value:
        risk.distance_km != null && Number.isFinite(Number(risk.distance_km))
          ? `${risk.distance_km} km`
          : isEnglish(locale)
            ? "Not marked"
            : "未标注",
    },
    {
      label: isEnglish(locale) ? "Observation update" : "观测更新",
      value:
        current.obs_time ||
        detail.updated_at ||
        (isEnglish(locale) ? "Unavailable" : "未提供"),
    },
    {
      label: isEnglish(locale) ? "Nearby stations" : "周边站点",
      value:
        nearbyCount > 0
          ? isEnglish(locale)
            ? `${nearbyCount} participating stations`
            : `${nearbyCount} 个参与监控`
          : isEnglish(locale)
            ? "No nearby stations"
            : "暂无周边站",
    },
  ];
}

export function getSettlementRiskNarrative(
  detail: CityDetail,
  locale: Locale = "zh-CN",
) {
  const risk = detail.risk || {};
  const sourceCode = getObservationSourceCode(detail);
  const stationTerm = sourceCode === "hko" || sourceCode === "cwa" || sourceCode === "noaa"
    ? isEnglish(locale)
      ? "settlement reference station"
      : "结算参考站"
    : isEnglish(locale)
      ? "settlement airport"
      : "结算机场";
  const lines: string[] = [];

  if (risk.warning) {
    lines.push(
      isEnglish(locale)
        ? `Current key risk: ${risk.warning}`
        : `当前主要风险是：${risk.warning}`,
    );
  }

  if (risk.distance_km != null) {
    if (risk.distance_km >= 60) {
      lines.push(
        isEnglish(locale)
          ? `The ${stationTerm} is far from urban core; market feel and settlement value may diverge significantly.`
          : `${stationTerm}与城市核心区域距离偏大，盘面温度与结算值可能出现明显背离。`,
      );
    } else if (risk.distance_km >= 25) {
      lines.push(
        isEnglish(locale)
          ? `The ${stationTerm} has material distance from downtown; peak/overnight rhythm should prioritize the settlement station.`
          : `${stationTerm}与城区存在可感知距离，午后峰值和夜间降温节奏需要优先看结算站。`,
      );
    } else {
      lines.push(
        isEnglish(locale)
          ? `The ${stationTerm} is close enough; city feel and settlement temperature are usually more synchronized.`
          : `${stationTerm}距离较近，城市体感与结算温度通常更同步。`,
      );
    }
  }

  if (detail.name === "ankara") {
    lines.push(
      isEnglish(locale)
        ? "For Ankara, focus on LTAC / Esenboğa plus MGM nearby-station linkage, not urban sensation alone."
        : "Ankara 需要重点看 LTAC / Esenboğa 与 MGM 周边站联动，不能只看城区体感。",
    );
  }

  if (detail.current?.obs_age_min != null) {
    if (detail.current.obs_age_min >= 45) {
      lines.push(
        isEnglish(locale)
          ? `Current METAR is ${detail.current.obs_age_min} minutes old. Blend nearby stations for nowcast instead of single-station snapshot.`
          : `当前 METAR 已有 ${detail.current.obs_age_min} 分钟时滞，临近判断要结合周边站而不是只看主站快照。`,
      );
    } else {
      lines.push(
        isEnglish(locale)
          ? "Primary station observation is fresh enough; short-term judgement can anchor on it."
          : "当前主站观测较新，短时判断可以把主站温度作为主要锚点。",
      );
    }
  }

  return lines;
}

export function getClimateDrivers(detail: CityDetail, locale: Locale = "zh-CN") {
  const drivers: Array<{ label: string; text: string }> = [];
  const lat = Math.abs(Number(detail.lat));
  const nearbyCount = Array.isArray(detail.mgm_nearby)
    ? detail.mgm_nearby.length
    : 0;
  const distanceKm = Number(detail.risk?.distance_km);

  if (lat >= 50) {
    drivers.push({
      label: isEnglish(locale) ? "High-latitude cold air" : "高纬冷空气",
      text: isEnglish(locale)
        ? "At higher latitude, temperature rhythm is more affected by cold-air surges, trough passage, and seasonal radiation angle."
        : "该城市位于较高纬度，温度变化更容易受到冷空气南下、短波槽和日照角度变化影响。",
    });
  } else if (lat >= 35) {
    drivers.push({
      label: isEnglish(locale) ? "Mid-latitude westerlies" : "中纬西风带",
      text: isEnglish(locale)
        ? "Temperature shifts are often controlled by frontal transitions rather than pure daytime radiation."
        : "该城市主要受中纬西风带和锋面活动控制，升降温常来自气团切换，而不是单一日照变化。",
    });
  } else if (lat >= 20) {
    drivers.push({
      label: isEnglish(locale) ? "Subtropical highs" : "副热带高压",
      text: isEnglish(locale)
        ? "Subtropical ridge, clear-sky radiation and low-level warm advection often dominate warming efficiency."
        : "该城市更容易受副热带高压、晴空辐射和低层暖平流影响，午后增温能力通常更强。",
    });
  } else {
    drivers.push({
      label: isEnglish(locale) ? "Tropical moisture & convection" : "热带水汽与对流",
      text: isEnglish(locale)
        ? "Temperature and feels-like are often modulated by moisture transport, cloud convection and showers."
        : "该城市偏热带环境，温度与体感常受水汽输送、云对流和阵雨触发影响。",
    });
  }

  drivers.push({
    label: isEnglish(locale) ? "Dry-wet boundary layer" : "干湿边界层",
    text: isEnglish(locale)
      ? "Boundary-layer humidity controls daytime warming efficiency; dry boundary warms faster, wet boundary is more cloud/precip-sensitive."
      : "低层干湿状态会决定午后升温效率。干空气通常升温更快，湿空气更容易受云量和降水过程抑制。",
  });

  drivers.push({
    label: isEnglish(locale) ? "Advection transport" : "平流输送",
    text: isEnglish(locale)
      ? "Short-term trend is usually driven by low-level air-mass transport. Persistent wind origin tends to sustain thermal direction."
      : "短时趋势常由低层气团输送控制。若风向持续来自同一侧，温度通常更容易沿该方向延续。",
  });

  if (Number.isFinite(distanceKm) && distanceKm >= 25) {
    drivers.push({
      label: isEnglish(locale) ? "Station representativeness" : "站点代表性",
      text: isEnglish(locale)
        ? "When settlement station is not near city core, perceived temperature and settlement value may diverge."
        : "结算站与城市核心区存在一定距离时，体感温度和结算温度可能分离，评估时应优先以结算站观测为准。",
    });
  }

  if (nearbyCount >= 4) {
    drivers.push({
      label: isEnglish(locale) ? "Local heterogeneity" : "局地差异",
      text: isEnglish(locale)
        ? "More nearby stations suggest terrain/urban-heat heterogeneity; settlement station and downtown sensation should be evaluated separately."
        : "周边可用站点较多，说明地形、城区热岛或下垫面差异可能明显，结算站与城区体感需要分开评估。",
    });
  }

  return drivers;
}
