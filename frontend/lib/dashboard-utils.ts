import { AiAnalysisStructured, CityDetail, HistoryPoint, NearbyStation } from "@/lib/dashboard-types";

const METAR_WX_MAP: Record<string, { label: string; icon: string }> = {
  RA: { label: "降雨", icon: "🌧️" },
  "-RA": { label: "小雨", icon: "🌦️" },
  "+RA": { label: "强降雨", icon: "⛈️" },
  SN: { label: "降雪", icon: "❄️" },
  "-SN": { label: "小雪", icon: "🌨️" },
  "+SN": { label: "大雪", icon: "🌨️" },
  DZ: { label: "毛毛雨", icon: "🌦️" },
  FG: { label: "雾", icon: "🌫️" },
  BR: { label: "薄雾", icon: "🌫️" },
  HZ: { label: "霾", icon: "🌫️" },
  TS: { label: "雷暴", icon: "⛈️" },
  VCTS: { label: "附近雷暴", icon: "⛈️" },
  SQ: { label: "飑线", icon: "💨" },
  GS: { label: "冰雹", icon: "🌨️" },
};

export function translateMetar(code?: string | null) {
  if (!code) return null;
  for (const [key, value] of Object.entries(METAR_WX_MAP)) {
    if (String(code).includes(key)) return value;
  }
  return { label: code, icon: "🌤️" };
}

export function getRiskBadgeLabel(level?: string | null) {
  return (
    {
      high: "🔴 高风险",
      medium: "🟠 中风险",
      low: "🟢 低风险",
    }[String(level || "low")] || "未知风险"
  );
}

export function getWeatherSummary(detail: CityDetail) {
  const current = detail.current || {};
  let weatherText = current.cloud_desc || "未知";
  let weatherIcon =
    {
      多云: "☁️",
      阴天: "☁️",
      少云: "🌤️",
      散云: "⛅",
      晴: "☀️",
      晴朗: "☀️",
    }[String(current.cloud_desc || "")] || "🌤️";

  if (current.wx_desc) {
    const translated = translateMetar(current.wx_desc);
    if (translated) {
      weatherText = translated.label;
      weatherIcon = translated.icon;
    }
  }

  return { weatherIcon, weatherText };
}

export function getHeroMetaItems(detail: CityDetail) {
  const current = detail.current || {};
  const parts: string[] = [];

  if (current.obs_time) {
    const ageText =
      current.obs_age_min != null && current.obs_age_min >= 30
        ? `（${current.obs_age_min} 分钟前）`
        : "";
    parts.push(`✈️ METAR ${current.obs_time}${ageText}`);
  }

  if (current.wx_desc) {
    const translated = translateMetar(current.wx_desc);
    if (translated) {
      parts.push(`${translated.icon} ${translated.label}`);
    }
  } else if (current.cloud_desc) {
    parts.push(`☁️ ${current.cloud_desc}`);
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
    parts.push(`📡 MGM 实测: ${detail.mgm.temp}${detail.temp_symbol}${timeText}`);
  }

  const trend = detail.trend || {};
  if (trend.is_dead_market) {
    parts.push("☠️ 死盘");
  } else if (trend.direction && trend.direction !== "unknown") {
    const labels: Record<string, string> = {
      rising: "📈 升温中",
      falling: "📉 降温中",
      stagnant: "⏸️ 持平",
      mixed: "📊 波动中",
    };
    parts.push(labels[trend.direction] || trend.direction);
  }

  return parts;
}

export function getTemperatureChartData(detail: CityDetail) {
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
    legendParts.push(`DEB 偏移 ${sign}${offset.toFixed(1)}${detail.temp_symbol} vs OM`);
  }
  if (hasMgmHourly) {
    legendParts.push("已使用 MGM 小时预报替代 DEB 曲线");
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

function bucketLabel(bucket: string | null) {
  return (
    {
      southerly: "南 / 西南风",
      northerly: "北 / 西北风",
      easterly: "东风",
      westerly: "西风",
    }[bucket || ""] || "风向不明"
  );
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

export function computeFrontTrendSignal(detail: CityDetail, dateStr: string) {
  const slice = getFutureSlice(detail, dateStr);
  const currentTemp = Number(detail.current?.temp);
  const currentDew = Number(detail.current?.dewpoint);

  if (!slice.length) {
    return {
      confidence: "low",
      label: "监控中",
      metrics: [] as Array<{
        label: string;
        note: string;
        tone?: string;
        value: string;
      }>,
      precipMax: 0,
      score: 0,
      summary: "未来 48 小时结构化数据不足，暂时只保留基础监控。",
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
  const label =
    score >= 18
      ? "暖平流 / 暖锋倾向"
      : score <= -18
        ? "冷平流 / 冷锋倾向"
        : "监控中";
  const confidence =
    Math.abs(score) >= 45 ? "high" : Math.abs(score) >= 22 ? "medium" : "low";

  return {
    confidence,
    label,
    metrics: [
      {
        label: "温度变化",
        note: "Open-Meteo 未来小时温度变化",
        tone: tempDelta >= 0.8 ? "warm" : tempDelta <= -0.8 ? "cold" : "",
        value: formatDelta(tempDelta, detail.temp_symbol),
      },
      {
        label: "露点变化",
        note: "露点上升更偏向暖湿平流",
        tone: dewDelta >= 0.8 ? "warm" : dewDelta <= -0.8 ? "cold" : "",
        value: formatDelta(dewDelta, detail.temp_symbol),
      },
      {
        label: "气压变化",
        note: "气压回升更偏向冷空气压入",
        tone: pressureDelta >= 1 ? "cold" : pressureDelta <= -1 ? "warm" : "",
        value: formatDelta(pressureDelta, " hPa"),
      },
      {
        label: "风向演变",
        note: "关注是否转南风或转北风",
        value: `${bucketLabel(firstBucket)} -> ${bucketLabel(lastBucket)}`,
      },
      {
        label: "降水概率",
        note: "weather.gov / Open-Meteo 降水提示",
        tone: precipMax >= 50 ? "cold" : "",
        value: `${Math.round(precipMax)}%`,
      },
      {
        label: "云量变化",
        note: "云量抬升但未降温，常见于暖平流前段",
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
      label === "暖平流 / 暖锋倾向"
        ? "风向更偏南 / 西南，露点与温度整体抬升，未来 6-48 小时偏向暖平流。"
        : label === "冷平流 / 冷锋倾向"
          ? "温度下滑、气压回升或风向转北，未来 6-48 小时更像冷锋或冷平流压制。"
          : detail.name !== "ankara" && Boolean(detail.source_forecasts?.meteoblue)
            ? "结构化来源以 weather.gov、Open-Meteo、Meteoblue 为主，用于判断未来 6-48 小时冷暖平流趋势。"
            : "结构化来源以 weather.gov 与 Open-Meteo 为主，用于判断未来 6-48 小时冷暖平流趋势。",
    weatherGovPeriods,
  };
}

export function getFutureModalView(detail: CityDetail, dateStr: string) {
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
    front: computeFrontTrendSignal(detail, dateStr),
    models: dailyModel.models || {},
    mu: Number.isFinite(Number(mu)) ? Number(mu) : null,
    probabilities,
    slice: getFutureSlice(detail, dateStr),
  };
}

export function getShortTermNowcastLines(detail: CityDetail, dateStr: string) {
  const slice = getFutureSlice(detail, dateStr);
  if (dateStr !== detail.local_date) {
    const afternoon = slice.filter((point) => {
      const hour = Number.parseInt(String(point.label).split(":")[0], 10);
      return Number.isFinite(hour) && hour >= 12 && hour <= 18;
    });
    const target = afternoon.length ? afternoon : slice;
    if (!target.length) {
      return [
        ["目标日期", dateStr],
        ["峰值窗口", "暂无足够的小时级 forecast 数据，无法生成目标日午后峰值窗口判断。"],
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
      ["目标日期", dateStr],
      ["峰值窗口", `${start.label} - ${end.label}（优先取 12:00-18:00）`],
      [
        "峰值预估",
        `${Number.isFinite(Number(peakPoint.temp)) ? Number(peakPoint.temp).toFixed(1) : "--"}${detail.temp_symbol} @ ${peakPoint.label || "--"}`,
      ],
      [
        "窗口温度",
        `${Number.isFinite(startTemp) ? startTemp.toFixed(1) : "--"}${detail.temp_symbol} -> ${Number.isFinite(endTemp) ? endTemp.toFixed(1) : "--"}${detail.temp_symbol}（${formatDelta(endTemp - startTemp, detail.temp_symbol)}）`,
      ],
      ["露点变化", `${formatDelta(endDew - startDew, detail.temp_symbol)}，用于判断午后暖湿输送是否增强。`],
      [
        "风向演变",
        `${bucketLabel(trendBucketFromDir(start.windDir))} -> ${bucketLabel(trendBucketFromDir(end.windDir))}，关注峰值前后是否转南风或回摆北风。`,
      ],
      ["气压变化", `${formatDelta(endPressure - startPressure, " hPa")}，上升更偏向冷空气压入。`],
      ["降水 / 云量", `${Math.round(maxPrecip)}% / ${Math.round(maxCloud)}%，用于判断峰值时段是否受云系压制。`],
    ] as const;
  }

  const recent = Array.isArray(detail.metar_recent_obs)
    ? detail.metar_recent_obs.slice(-4)
    : [];
  const nearby = Array.isArray(detail.mgm_nearby) ? detail.mgm_nearby : [];
  const sourceLabel = detail.name === "ankara" ? "MGM 周边站" : "METAR 周边站";
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
        name: station.name || station.icao || "周边站",
        temp,
      };
    }
  }

  const rows: Array<readonly [string, string]> = [
    ["当前主站", `${detail.current?.temp ?? "--"}${detail.temp_symbol} @ ${detail.current?.obs_time || "--"}`],
    ["原始 METAR", detail.current?.raw_metar || "暂无"],
    ["近 0-2 小时", `${formatDelta(shortDelta, detail.temp_symbol)}，依据最近 METAR 序列判断短时动量。`],
    [sourceLabel, `${nearby.length} 个站点参与邻近监控。`],
  ];

  if (nearbyLead) {
    const tone =
      nearbyLead.diff > 0 ? "偏暖" : nearbyLead.diff < 0 ? "偏冷" : "持平";
    rows.push([
      "领先站",
      `${nearbyLead.name} ${nearbyLead.temp}${detail.temp_symbol}，相对主站 ${formatDelta(nearbyLead.diff, detail.temp_symbol)}（${tone}）。`,
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
      if (Math.round(row.actual) === Math.round(row.deb)) {
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

export function getCityProfileStats(detail: CityDetail) {
  const risk = detail.risk || {};
  const current = detail.current || {};
  const nearbyCount = Array.isArray(detail.mgm_nearby) ? detail.mgm_nearby.length : 0;

  return [
    {
      label: "结算机场",
      value: risk.airport && risk.icao ? `${risk.airport} (${risk.icao})` : "暂无档案",
    },
    {
      label: "站点距离",
      value:
        risk.distance_km != null && Number.isFinite(Number(risk.distance_km))
          ? `${risk.distance_km} km`
          : "未标注",
    },
    {
      label: "观测更新",
      value: current.obs_time || detail.updated_at || "未提供",
    },
    {
      label: "周边站点",
      value: nearbyCount > 0 ? `${nearbyCount} 个参与监控` : "暂无周边站",
    },
  ];
}

export function getSettlementRiskNarrative(detail: CityDetail) {
  const risk = detail.risk || {};
  const lines: string[] = [];

  if (risk.warning) {
    lines.push(`当前主要风险是：${risk.warning}`);
  }

  if (risk.distance_km != null) {
    if (risk.distance_km >= 60) {
      lines.push("结算机场与城市核心区域距离偏大，盘面温度与结算值可能出现明显背离。");
    } else if (risk.distance_km >= 25) {
      lines.push("结算机场与城区存在可感知距离，午后峰值和夜间降温节奏需要优先看机场站。");
    } else {
      lines.push("结算机场距离较近，城市体感与结算温度通常更同步。");
    }
  }

  if (detail.name === "ankara") {
    lines.push("Ankara 需要重点看 LTAC / Esenboğa 与 MGM 周边站联动，不能只看城区体感。");
  }

  if (detail.current?.obs_age_min != null) {
    if (detail.current.obs_age_min >= 45) {
      lines.push(`当前 METAR 已有 ${detail.current.obs_age_min} 分钟时滞，临近判断要结合周边站而不是只看主站快照。`);
    } else {
      lines.push("当前主站观测较新，短时判断可以把主站温度作为主要锚点。");
    }
  }

  return lines;
}

export function getClimateDrivers(detail: CityDetail) {
  const drivers: Array<{ label: string; text: string }> = [];
  const lat = Math.abs(Number(detail.lat));
  const current = detail.current || {};
  const temp = Number(current.temp);
  const dewPoint = Number(current.dewpoint);
  const humidity = Number(current.humidity);
  const windSpeed = Number(current.wind_speed_kt);
  const nearbyCount = Array.isArray(detail.mgm_nearby) ? detail.mgm_nearby.length : 0;

  if (lat >= 50) {
    drivers.push({
      label: "高纬冷空气",
      text: "这座城市处在较高纬度，气温更容易受冷空气南下、短波槽和日照角度变化影响，波动通常偏快。",
    });
  } else if (lat >= 35) {
    drivers.push({
      label: "中纬度西风带",
      text: "这座城市主要受中纬度西风带和锋面活动控制，升温或降温往往来自气团切换，而不是单一的日照变化。",
    });
  } else if (lat >= 20) {
    drivers.push({
      label: "副热带高压",
      text: "这座城市更容易受到副热带高压、晴空辐射和低层暖平流影响，午后冲高能力通常比高纬城市更强。",
    });
  } else {
    drivers.push({
      label: "热带水汽与对流",
      text: "这座城市更偏热带环境，温度与体感常受水汽输送、云对流和阵雨触发影响，不完全由晴空辐射主导。",
    });
  }

  if (Number.isFinite(windSpeed) && windSpeed >= 12) {
    drivers.push({
      label: "平流输送",
      text: `当前风速约 ${windSpeed}kt，说明低层输送比较明显，盘面短时方向更容易被外来气团带动。`,
    });
  } else if (detail.trend?.is_dead_market) {
    drivers.push({
      label: "本地辐射主导",
      text: "近期更像本地辐射和地表热量收支在主导，若无新气团介入，温度节奏通常更平滑。",
    });
  }

  if (
    Number.isFinite(temp) &&
    Number.isFinite(dewPoint) &&
    temp - dewPoint <= 3
  ) {
    drivers.push({
      label: "湿度与云量约束",
      text: "当前温度和露点接近，说明低层湿度较高。午后峰值容易受云量和降水触发抑制。",
    });
  } else if (Number.isFinite(humidity) && humidity >= 70) {
    drivers.push({
      label: "湿层偏厚",
      text: "相对湿度偏高，说明局地升温效率会受到水汽和云层反馈影响，冲高空间要比干空气场景更小心。",
    });
  } else {
    drivers.push({
      label: "干暖边界层",
      text: "低层空气相对偏干，晴空时段的升温效率通常更高，午后冲顶更依赖辐射和风向切换。",
    });
  }

  if (nearbyCount >= 4) {
    drivers.push({
      label: "局地差异",
      text: "周边可用站点较多，说明地形、城区热岛或下垫面差异可能明显，结算站与城区体感需要分开看。",
    });
  }

  return drivers;
}
