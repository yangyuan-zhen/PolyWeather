import { CityDetail, CityListItem } from "@/lib/dashboard-types";

export interface WeatherAuraProfile {
  primary: string;
  secondary: string;
  tertiary: string;
  intensity: number;
  drift: number;
  particleOpacity: number;
  effect: WeatherAuraEffect;
  effectIntensity: number;
}

export type WeatherAuraEffect =
  | "rain"
  | "snow"
  | "fog"
  | "storm"
  | "wind"
  | "cloud"
  | "clear";

const RISK_AURA: Record<
  string,
  Omit<WeatherAuraProfile, "intensity" | "drift" | "effect" | "effectIntensity">
> =
  {
    high: {
      primary: "#ff7c2a",
      secondary: "#ffcf66",
      tertiary: "#56c7ff",
      particleOpacity: 0.42,
    },
    medium: {
      primary: "#f6c453",
      secondary: "#5eead4",
      tertiary: "#7dd3fc",
      particleOpacity: 0.34,
    },
    low: {
      primary: "#38bdf8",
      secondary: "#22d3ee",
      tertiary: "#34d399",
      particleOpacity: 0.28,
    },
    default: {
      primary: "#6ee7ff",
      secondary: "#7c8dff",
      tertiary: "#60a5fa",
      particleOpacity: 0.3,
    },
  };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getWeatherAuraProfile(
  detail: CityDetail | null,
  cities: CityListItem[],
): WeatherAuraProfile {
  const dominantRisk =
    String(detail?.risk?.level || "").toLowerCase() ||
    String(cities.find((city) => city.risk_level)?.risk_level || "").toLowerCase() ||
    "default";

  const base = RISK_AURA[dominantRisk] || RISK_AURA.default;
  const currentTemp = Number(detail?.current?.temp);
  const validTemp = Number.isFinite(currentTemp) ? currentTemp : 18;
  const intensity = clamp(0.7 + validTemp / 40, 0.72, 1.45);
  const drift = clamp(0.45 + validTemp / 30, 0.55, 1.35);
  const particleOpacity = clamp(base.particleOpacity + (intensity - 1) * 0.08, 0.22, 0.48);
  const wxText = `${String(detail?.current?.wx_desc || "")} ${String(
    detail?.current?.cloud_desc || "",
  )}`.toUpperCase();
  const windSpeed = Number(detail?.current?.wind_speed_kt);
  const humidity = Number(detail?.current?.humidity);

  let effect: WeatherAuraEffect = "clear";
  if (
    /(TS|VCTS|THUNDER|雷暴|LIGHTNING)/.test(wxText)
  ) {
    effect = "storm";
  } else if (/(SN|SG|GS|ICE|SLEET|雪|霰)/.test(wxText)) {
    effect = "snow";
  } else if (/(RA|DZ|SHRA|SHOWER|RAIN|DRIZZLE|雨)/.test(wxText)) {
    effect = "rain";
  } else if (/(FG|BR|HZ|FU|MIST|FOG|雾|霾)/.test(wxText)) {
    effect = "fog";
  } else if (
    /(BKN|OVC|SCT|FEW|CLOUD|云|阴)/.test(wxText)
  ) {
    effect = "cloud";
  } else if (Number.isFinite(windSpeed) && windSpeed >= 18) {
    effect = "wind";
  }

  const effectIntensity =
    effect === "storm"
      ? clamp(
          0.9 +
            (Number.isFinite(windSpeed) ? windSpeed / 35 : 0) +
            (Number.isFinite(humidity) ? humidity / 220 : 0),
          0.9,
          1.9,
        )
      : effect === "rain"
        ? clamp(
            0.75 +
              (Number.isFinite(humidity) ? humidity / 180 : 0) +
              (Number.isFinite(windSpeed) ? windSpeed / 45 : 0),
            0.72,
            1.7,
          )
        : effect === "snow"
          ? clamp(0.8 + (Number.isFinite(windSpeed) ? windSpeed / 50 : 0), 0.78, 1.4)
          : effect === "fog"
            ? clamp(0.78 + (Number.isFinite(humidity) ? humidity / 240 : 0), 0.75, 1.3)
            : effect === "wind"
              ? clamp(0.72 + (Number.isFinite(windSpeed) ? windSpeed / 40 : 0), 0.72, 1.5)
              : effect === "cloud"
                ? 0.82
                : 0.72;

  return {
    ...base,
    intensity,
    drift,
    particleOpacity,
    effect,
    effectIntensity,
  };
}
