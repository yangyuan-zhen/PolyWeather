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
  RA: { en: "Rain", icon: "🌧️", zh: "降雨" },
  "-RA": { en: "Light rain", icon: "🌦️", zh: "小雨" },
  "+RA": { en: "Heavy rain", icon: "⛈️", zh: "强降雨" },
  SN: { en: "Snow", icon: "❄️", zh: "降雪" },
  "-SN": { en: "Light snow", icon: "🌨️", zh: "小雪" },
  "+SN": { en: "Heavy snow", icon: "🌨️", zh: "大雪" },
  DZ: { en: "Drizzle", icon: "🌦️", zh: "毛毛雨" },
  FG: { en: "Fog", icon: "🌫️", zh: "雾" },
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

  if (current.obs_time) {
    const ageText =
      current.obs_age_min != null && current.obs_age_min >= 30
        ? isEnglish(locale)
          ? ` (${current.obs_age_min} min ago)`
          : `（${current.obs_age_min} 分钟前）`
        : "";
    parts.push(`✈️ METAR ${current.obs_time}${ageText}`);
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

  const metarPoints = new Array(times.length).fill(null);
  const metarSource = detail.metar_today_obs?.length
    ? detail.metar_today_obs
    : detail.trend?.recent || [];

  metarSource.forEach((item) => {
    const parts = String(item.time || "").split(":");
    let hour = Number.parseInt(parts[0], 10);
    const minute = Number.parseInt(parts[1] || "0", 10);
    if (Number.isNaN(hour)) return;
    if (minute >= 30) hour = (hour + 1) % 24;
    const key = `${String(hour).padStart(2, "0")}:00`;
    const index = times.indexOf(key);
    if (index >= 0 && metarPoints[index] === null) {
      metarPoints[index] = item.temp ?? null;
    }
  });

  const mgmPoints = new Array(times.length).fill(null);
  if (detail.mgm?.temp != null && detail.mgm?.time) {
    const match = detail.mgm.time.match(/T?(\d{2}):(\d{2})/);
    if (match) {
      let hour = Number.parseInt(match[1], 10);
      const minute = Number.parseInt(match[2], 10);
      if (minute >= 30) hour = (hour + 1) % 24;
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
  if (detail.trend?.recent?.length) {
    const recentText = [...detail.trend.recent]
      .slice(0, 4)
      .reverse()
      .map((item) => `${item.temp}${detail.temp_symbol}@${item.time}`)
      .join(" -> ");
    legendParts.push(`METAR: ${recentText}`);
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
      temps,
    },
    legendText: legendParts.join(" | "),
    max,
    min,
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
      precipMax: 0,
      score: 0,
      summary: isEnglish(locale)
        ? "Insufficient 48h structured data. Keep baseline monitoring."
        : "未来 48 小时结构化数据不足，暂时只保留基础监控。",
      weatherGovPeriods: [] as ReturnType<typeof getForecastTextForDate>,
    };
  }

  const first = slice[0];
  const last = slice[slice.length - 1];
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
  const warmLabel = isEnglish(locale)
    ? "Warm advection / warm-front tendency"
    : "暖平流 / 暖锋倾向";
  const coldLabel = isEnglish(locale)
    ? "Cold advection / cold-front tendency"
    : "冷平流 / 冷锋倾向";
  const monitorLabel = isEnglish(locale) ? "Monitoring" : "监控中";
  const label = score >= 18 ? warmLabel : score <= -18 ? coldLabel : monitorLabel;
  const confidence =
    Math.abs(score) >= 45 ? "high" : Math.abs(score) >= 22 ? "medium" : "low";

  return {
    confidence,
    label,
    metrics: [
      {
        label: isEnglish(locale) ? "Temperature delta" : "温度变化",
        note: isEnglish(locale)
          ? "Open-Meteo upcoming hourly temperature change"
          : "Open-Meteo 未来小时温度变化",
        tone: tempDelta >= 0.8 ? "warm" : tempDelta <= -0.8 ? "cold" : "",
        value: formatDelta(tempDelta, detail.temp_symbol),
      },
      {
        label: isEnglish(locale) ? "Dew point delta" : "露点变化",
        note: isEnglish(locale)
          ? "Rising dew point often supports warm/wet advection"
          : "露点上升更偏向暖湿平流",
        tone: dewDelta >= 0.8 ? "warm" : dewDelta <= -0.8 ? "cold" : "",
        value: formatDelta(dewDelta, detail.temp_symbol),
      },
      {
        label: isEnglish(locale) ? "Pressure delta" : "气压变化",
        note: isEnglish(locale)
          ? "Pressure rebound usually implies cold-air push"
          : "气压回升更偏向冷空气压入",
        tone: pressureDelta >= 1 ? "cold" : pressureDelta <= -1 ? "warm" : "",
        value: formatDelta(pressureDelta, " hPa"),
      },
      {
        label: isEnglish(locale) ? "Wind-direction evolution" : "风向演变",
        note: isEnglish(locale)
          ? "Focus on switch to southerly or northerly flow"
          : "关注是否转南风或转北风",
        value: `${bucketLabel(firstBucket, locale)} -> ${bucketLabel(lastBucket, locale)}`,
      },
      {
        label: isEnglish(locale) ? "Precip probability" : "降水概率",
        note: "weather.gov / Open-Meteo",
        tone: precipMax >= 50 ? "cold" : "",
        value: `${Math.round(precipMax)}%`,
      },
      {
        label: isEnglish(locale) ? "Cloud-cover delta" : "云量变化",
        note: isEnglish(locale)
          ? "Cloud increase without cooling may imply warm advection"
          : "云量抬升但未降温，常见于暖平流前段",
        tone:
          cloudDelta >= 15 && tempDelta >= 0
            ? "warm"
            : cloudDelta >= 15 && tempDelta < 0
              ? "cold"
              : "",
        value: formatDelta(cloudDelta, "%"),
      },
    ],
    precipMax,
    score,
    summary:
      label === warmLabel
        ? isEnglish(locale)
          ? "Southerly flow strengthens with rising dew point and temperature. Next 6-48h leans warm advection."
          : "风向更偏南 / 西南，露点与温度整体抬升，未来 6-48 小时偏向暖平流。"
        : label === coldLabel
          ? isEnglish(locale)
            ? "Temperature declines with pressure rebound and/or northerly shift. Next 6-48h leans cold-front suppression."
            : "温度下滑、气压回升或风向转北，未来 6-48 小时更像冷锋或冷平流压制。"
            : isEnglish(locale)
              ? "Structured trend layer mainly uses weather.gov and Open-Meteo for 6-48h warm/cold flow judgement."
              : "结构化来源以 weather.gov 和 Open-Meteo 为主，用于判断未来 6-48 小时冷暖平流趋势。",
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
  const sourceLabel =
    detail.name === "ankara"
      ? isEnglish(locale)
        ? "MGM nearby stations"
        : "MGM 周边站"
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

  let hits = 0;
  const debErrors: number[] = [];
  settledData.forEach((row) => {
    if (row.actual != null && row.deb != null) {
      debErrors.push(Math.abs(row.actual - row.deb));
      if (wuRound(row.actual) === wuRound(row.deb)) {
        hits += 1;
      }
    }
  });

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
    hitRate: debErrors.length
      ? Number(((hits / debErrors.length) * 100).toFixed(0))
      : null,
    mgms: recentData.map((row) => row.mgm ?? null),
    recentData,
    settledCount: settledData.length,
    actuals: recentData.map((row) => row.actual),
  };
}

export function getCityProfileStats(detail: CityDetail, locale: Locale = "zh-CN") {
  const risk = detail.risk || {};
  const current = detail.current || {};
  const nearbyCount = Array.isArray(detail.mgm_nearby) ? detail.mgm_nearby.length : 0;

  return [
    {
      label: isEnglish(locale) ? "Settlement airport" : "结算机场",
      value:
        risk.airport && risk.icao
          ? `${risk.airport} (${risk.icao})`
          : isEnglish(locale)
            ? "No profile"
            : "暂无档案",
    },
    {
      label: isEnglish(locale) ? "Station distance" : "站点距离",
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
          ? "Settlement airport is far from urban core; market feel and settlement value may diverge significantly."
          : "结算机场与城市核心区域距离偏大，盘面温度与结算值可能出现明显背离。",
      );
    } else if (risk.distance_km >= 25) {
      lines.push(
        isEnglish(locale)
          ? "Settlement airport has material distance from downtown; peak/overnight rhythm should prioritize airport station."
          : "结算机场与城区存在可感知距离，午后峰值和夜间降温节奏需要优先看机场站。",
      );
    } else {
      lines.push(
        isEnglish(locale)
          ? "Settlement airport is close enough; city feel and settlement temperature are usually more synchronized."
          : "结算机场距离较近，城市体感与结算温度通常更同步。",
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
