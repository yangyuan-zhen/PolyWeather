import type { CityDetail } from "@/lib/dashboard-types";
import type { Locale } from "@/lib/i18n";
import {
  getRealtimeObservationTag,
  isTurkishMgmCity,
} from "@/lib/observation-source-utils";

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
  const sourceTag = getRealtimeObservationTag(detail);
  const suppressAnkaraMgmObservation = isTurkishMgmCity(detail);

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

  if (!suppressAnkaraMgmObservation && detail.mgm?.temp != null) {
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
