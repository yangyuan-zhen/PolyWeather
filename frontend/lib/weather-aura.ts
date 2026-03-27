import { CityDetail, CityListItem } from "@/lib/dashboard-types";

export interface WeatherAuraProfile {
  primary: string;
  secondary: string;
  tertiary: string;
  intensity: number;
  drift: number;
  particleOpacity: number;
}

const RISK_AURA: Record<string, Omit<WeatherAuraProfile, "intensity" | "drift">> =
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

  return {
    ...base,
    intensity,
    drift,
    particleOpacity,
  };
}
