import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { formatTemperatureValue } from "@/lib/temperature-utils";

export function decodeRawMetarCloud(rawMetar?: string | null, locale = "zh-CN") {
  const raw = String(rawMetar || "").toUpperCase();
  const matches = Array.from(raw.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})?\b/g));
  if (!matches.length) return "";
  const coverText: Record<string, { zh: string; en: string }> = {
    FEW: { zh: "少云", en: "few" },
    SCT: { zh: "散云", en: "scattered" },
    BKN: { zh: "多云", en: "broken" },
    OVC: { zh: "阴天", en: "overcast" },
  };
  return matches
    .slice(0, 3)
    .map((match) => {
      const cover = coverText[match[1]] || { zh: match[1], en: match[1] };
      const base = match[2] ? `${Number(match[2]) * 100}ft` : "";
      return locale === "en-US"
        ? [cover.en, base].filter(Boolean).join(" ")
        : [cover.zh, base].filter(Boolean).join(" ");
    })
    .join(locale === "en-US" ? ", " : "、");
}

export function decodeRawMetarVisibility(rawMetar?: string | null) {
  const raw = String(rawMetar || "").toUpperCase();
  if (/\b9999\b/.test(raw)) return "10km+";
  const meterMatch = raw.match(/\b(\d{4})\b/);
  if (meterMatch) return `${Number(meterMatch[1]) / 1000}km`;
  return "";
}

export function decodeMetarWeatherToken(token?: string | null, locale = "zh-CN") {
  const raw = String(token || "").trim().toUpperCase();
  if (!raw) return "";
  const isEn = locale === "en-US";
  const intensity = raw.startsWith("-")
    ? isEn
      ? "light "
      : "轻"
    : raw.startsWith("+")
      ? isEn
        ? "heavy "
        : "强"
      : "";
  const cleaned = raw.replace(/^[+-]/, "");
  const descriptors: Record<string, { zh: string; en: string }> = {
    VC: { zh: "附近", en: "nearby " },
    SH: { zh: "阵性", en: "showery " },
    TS: { zh: "雷暴性", en: "thunderstorm " },
    FZ: { zh: "冻", en: "freezing " },
    BL: { zh: "吹扬", en: "blowing " },
    DR: { zh: "低吹", en: "drifting " },
    MI: { zh: "浅层", en: "shallow " },
    BC: { zh: "碎片状", en: "patches of " },
    PR: { zh: "部分", en: "partial " },
  };
  const phenomena: Record<string, { zh: string; en: string }> = {
    DZ: { zh: "毛毛雨", en: "drizzle" },
    RA: { zh: "雨", en: "rain" },
    SN: { zh: "雪", en: "snow" },
    SG: { zh: "米雪", en: "snow grains" },
    IC: { zh: "冰晶", en: "ice crystals" },
    PL: { zh: "冰粒", en: "ice pellets" },
    GR: { zh: "冰雹", en: "hail" },
    GS: { zh: "小冰雹", en: "small hail" },
    UP: { zh: "未知降水", en: "unknown precipitation" },
    BR: { zh: "薄雾", en: "mist" },
    FG: { zh: "雾", en: "fog" },
    FU: { zh: "烟", en: "smoke" },
    VA: { zh: "火山灰", en: "volcanic ash" },
    DU: { zh: "浮尘", en: "dust" },
    SA: { zh: "沙", en: "sand" },
    HZ: { zh: "霾", en: "haze" },
    PY: { zh: "喷雾", en: "spray" },
    PO: { zh: "尘卷风", en: "dust whirls" },
    SQ: { zh: "飑", en: "squall" },
    FC: { zh: "漏斗云", en: "funnel cloud" },
    SS: { zh: "沙暴", en: "sandstorm" },
    DS: { zh: "尘暴", en: "duststorm" },
  };
  const descriptorText = Object.entries(descriptors)
    .filter(([code]) => cleaned.includes(code))
    .map(([, text]) => (isEn ? text.en : text.zh))
    .join("");
  const phenomenonText = Object.entries(phenomena)
    .filter(([code]) => cleaned.includes(code))
    .map(([, text]) => (isEn ? text.en : text.zh))
    .join(isEn ? " / " : "、");
  if (!phenomenonText) return "";
  return `${intensity}${descriptorText}${phenomenonText}`;
}

export function decodeRawMetarWeather(rawMetar?: string | null, locale = "zh-CN") {
  const raw = String(rawMetar || "").toUpperCase();
  const matches = Array.from(
    raw.matchAll(/\b([+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS))\b/g),
  );
  return Array.from(
    new Set(
      matches
        .map((match) => decodeMetarWeatherToken(match[1], locale))
        .filter(Boolean),
    ),
  ).join(locale === "en-US" ? ", " : "、");
}

export function getAirportWeatherInputs(row: ScanOpportunityRow, detail: CityDetail | null) {
  const context = row.metar_context || {};
  const airport: Partial<NonNullable<CityDetail["airport_current"]>> =
    detail?.airport_current || {};
  const rawMetar = String(context.airport_raw_metar || airport.raw_metar || "").trim();
  return {
    cloud: String(context.airport_cloud_desc || airport.cloud_desc || "").trim(),
    rawMetar,
    visibility:
      context.airport_visibility_mi != null && Number.isFinite(Number(context.airport_visibility_mi))
        ? Number(context.airport_visibility_mi)
        : airport.visibility_mi != null && Number.isFinite(Number(airport.visibility_mi))
          ? Number(airport.visibility_mi)
          : null,
    weather: String(context.airport_wx_desc || airport.wx_desc || "").trim(),
    windSpeed:
      context.airport_wind_speed_kt != null && Number.isFinite(Number(context.airport_wind_speed_kt))
        ? Number(context.airport_wind_speed_kt)
        : airport.wind_speed_kt != null && Number.isFinite(Number(airport.wind_speed_kt))
          ? Number(airport.wind_speed_kt)
          : null,
  };
}

export function formatAirportWeatherRead(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
) {
  const isEn = locale === "en-US";
  const inputs = getAirportWeatherInputs(row, detail);
  const decodedCloud = inputs.cloud || decodeRawMetarCloud(inputs.rawMetar, locale);
  const decodedWeather =
    decodeMetarWeatherToken(inputs.weather, locale) ||
    inputs.weather ||
    decodeRawMetarWeather(inputs.rawMetar, locale);
  const visibilityText =
    inputs.visibility != null ? `${inputs.visibility.toFixed(1)}mi` : decodeRawMetarVisibility(inputs.rawMetar);
  const cloudRaw = `${inputs.cloud} ${inputs.rawMetar}`.toUpperCase();
  const weatherRaw = `${inputs.weather} ${inputs.rawMetar}`.toUpperCase();
  const suppressors: string[] = [];
  const supporters: string[] = [];

  if (/(RA|DZ|SN|TS|SH|FG|BR|HZ|OVC|BKN)/.test(weatherRaw) || /(OVC|BKN)/.test(cloudRaw)) {
    suppressors.push(
      isEn
        ? "cloud, precipitation or restricted visibility can suppress solar heating"
        : "云雨、薄雾或低能见度会压制太阳辐射升温",
    );
  }
  if (inputs.visibility != null && inputs.visibility < 6) {
    suppressors.push(
      isEn
        ? `visibility is only ${visibilityText}, so the airport path may warm more slowly`
        : `能见度仅 ${visibilityText}，机场路径可能升温偏慢`,
    );
  }
  if (/(FEW|SCT)/.test(cloudRaw) && !/(RA|DZ|SN|TS|FG|BR|HZ|OVC|BKN)/.test(weatherRaw)) {
    supporters.push(
      isEn
        ? "few or scattered clouds do not block the heating path materially"
        : "少云或散云对日间升温压制不明显",
    );
  }
  if (inputs.windSpeed != null && inputs.windSpeed >= 15) {
    suppressors.push(
      isEn
        ? "stronger wind mixing can change the airport temperature path"
        : "风速偏大，边界层混合可能改写机场温度路径",
    );
  } else if (inputs.windSpeed != null && inputs.windSpeed <= 5 && !suppressors.length) {
    supporters.push(
      isEn
        ? "light wind leaves the temperature path mainly driven by local sunshine"
        : "风速较弱，温度路径更取决于本地日照",
    );
  }

  const descriptors = [
    decodedWeather ? (isEn ? `weather ${decodedWeather}` : `天气 ${decodedWeather}`) : null,
    decodedCloud ? (isEn ? `cloud ${decodedCloud}` : `云况 ${decodedCloud}`) : null,
    visibilityText ? (isEn ? `visibility ${visibilityText}` : `能见度 ${visibilityText}`) : null,
  ].filter(Boolean);
  const read = suppressors[0] || supporters[0];
  if (!descriptors.length && !read) return null;
  const prefix = isEn ? "Airport weather read" : "机场气象解读";
  const evidence = descriptors.length ? `${descriptors.join(isEn ? ", " : "，")}；` : "";
  return `${prefix}：${evidence}${read || (isEn ? "no clear weather suppression signal yet" : "暂未看到明确天气压温信号")}。`;
}

export function formatAirportReportRead(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const context = row.metar_context || {};
  const airport: Partial<NonNullable<CityDetail["airport_current"]>> =
    detail?.airport_current || {};
  const station =
    context.station ||
    detail?.risk?.icao ||
    airport.station_code ||
    null;
  const obsTime =
    context.airport_obs_time ||
    context.last_time ||
    airport.obs_time ||
    row.metar_status?.last_observation_time ||
    null;
  const temp =
    context.airport_current_temp != null && Number.isFinite(Number(context.airport_current_temp))
      ? Number(context.airport_current_temp)
      : airport.temp != null && Number.isFinite(Number(airport.temp))
        ? Number(airport.temp)
        : null;
  const windSpeed =
    context.airport_wind_speed_kt != null && Number.isFinite(Number(context.airport_wind_speed_kt))
      ? Number(context.airport_wind_speed_kt)
      : airport.wind_speed_kt != null && Number.isFinite(Number(airport.wind_speed_kt))
        ? Number(airport.wind_speed_kt)
        : null;
  const windDir =
    context.airport_wind_dir != null && Number.isFinite(Number(context.airport_wind_dir))
      ? Number(context.airport_wind_dir)
      : airport.wind_dir != null && Number.isFinite(Number(airport.wind_dir))
        ? Number(airport.wind_dir)
        : null;
  const cloud = String(context.airport_cloud_desc || airport.cloud_desc || "").trim();
  const weather = String(context.airport_wx_desc || airport.wx_desc || "").trim();
  const rawMetar = String(context.airport_raw_metar || airport.raw_metar || "").trim();
  const decodedCloud = cloud || decodeRawMetarCloud(rawMetar, locale);
  const decodedWeather =
    decodeMetarWeatherToken(weather, locale) ||
    weather ||
    decodeRawMetarWeather(rawMetar, locale);
  const visibility =
    context.airport_visibility_mi != null && Number.isFinite(Number(context.airport_visibility_mi))
      ? Number(context.airport_visibility_mi)
      : airport.visibility_mi != null && Number.isFinite(Number(airport.visibility_mi))
        ? Number(airport.visibility_mi)
        : null;
  const decodedVisibility = visibility != null ? `${visibility.toFixed(1)}mi` : decodeRawMetarVisibility(rawMetar);

  const parts: string[] = [];
  if (temp != null) parts.push(formatTemperatureValue(temp, tempSymbol, { digits: 1 }));
  if (windSpeed != null) {
    parts.push(
      windDir != null
        ? isEn
          ? `wind ${Math.round(windDir)}°/${Math.round(windSpeed)}kt`
          : `风 ${Math.round(windDir)}°/${Math.round(windSpeed)}kt`
        : isEn
          ? `wind ${Math.round(windSpeed)}kt`
          : `风 ${Math.round(windSpeed)}kt`,
    );
  }
  if (decodedCloud) parts.push(isEn ? `cloud ${decodedCloud}` : `云况 ${decodedCloud}`);
  if (decodedWeather) parts.push(isEn ? `weather ${decodedWeather}` : `天气 ${decodedWeather}`);
  if (decodedVisibility) parts.push(isEn ? `visibility ${decodedVisibility}` : `能见度 ${decodedVisibility}`);
  if (!parts.length) return null;
  const prefix = isEn ? "Latest airport METAR read" : "最新机场报文解读";
  const head = [station, obsTime].filter(Boolean).join(" ");
  return `${prefix}${head ? ` ${head}` : ""}：${parts.join("，")}。`;
}
