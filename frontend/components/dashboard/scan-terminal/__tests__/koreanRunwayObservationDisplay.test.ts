import {
  getDisplayAirportPrimary,
  shouldSuppressKoreanRunwayObservation,
} from "@/lib/airport-observation-display";
import type { CityDetail } from "@/lib/dashboard-types";
import { getTodayPaceView } from "@/lib/pace-utils";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function baseDetail(overrides: Partial<CityDetail>): CityDetail {
  return {
    name: "seoul",
    display_name: "Seoul",
    local_date: "2026-05-17",
    local_time: "12:00",
    temp_symbol: "°C",
    current: {
      temp: 25,
      max_so_far: 27,
      max_temp_time: null,
      wu_settlement: null,
      station_code: "RKSI",
      obs_time: "12:00",
      obs_age_min: 1,
      wind_speed_kt: null,
      wind_dir: null,
      humidity: null,
      cloud_desc: null,
      clouds_raw: [],
      visibility_mi: null,
      wx_desc: null,
    },
    hourly: {
      times: ["10:00", "11:00", "12:00", "13:00"],
      temps: [24, 25, 26, 27],
    },
    forecast: { today_high: 29 },
    deb: { prediction: 29 },
    ...overrides,
  } as CityDetail;
}

export function runTests() {
  const seoul = baseDetail({
    airport_primary: {
      temp: 40,
      max_so_far: 41,
      obs_time: "12:00",
      source_code: "amos",
      source_label: "AMOS",
      station_code: "RKSI",
    },
    airport_current: {
      temp: 26,
      obs_time: "12:00",
      source_label: "METAR",
      station_code: "RKSI",
    },
    amos: {
      source: "amos",
      runway_temp_range: [39, 41],
    },
  });

  assert(
    shouldSuppressKoreanRunwayObservation(seoul),
    "Seoul AMOS runway observation should be suppressed in web city decision",
  );
  assert(
    getDisplayAirportPrimary(seoul) == null,
    "Seoul airport_primary AMOS runway observation must not be exposed for display",
  );

  const pace = getTodayPaceView(seoul, "zh-CN");
  assert(pace?.observedNow === 26, "pace view should fall back to METAR/current, not AMOS runway temp");

  const busan = baseDetail({
    name: "busan",
    display_name: "Busan",
    airport_primary: {
      temp: 35,
      obs_time: "12:00",
      source_label: "AMSC AWOS",
      station_code: "RKPK",
    },
  });
  assert(
    getDisplayAirportPrimary(busan) == null,
    "Busan AMSC/AWOS runway observation must not be exposed for display",
  );

  const tokyo = baseDetail({
    name: "tokyo",
    display_name: "Tokyo",
    airport_primary: {
      temp: 31,
      obs_time: "12:00",
      source_label: "AMOS",
      station_code: "RJTT",
    },
  });
  assert(
    getDisplayAirportPrimary(tokyo)?.temp === 31,
    "non-Korean cities should not be affected by the Seoul/Busan runway suppression",
  );
}
