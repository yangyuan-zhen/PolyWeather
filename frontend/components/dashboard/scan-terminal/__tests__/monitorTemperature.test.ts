import assert from "node:assert/strict";
import { resolveMonitorTemperature } from "@/components/dashboard/monitoring/monitor-temperature";
import type { CityDetail } from "@/lib/dashboard-types";

function detail(extra: Partial<CityDetail>): CityDetail {
  return {
    current: { temp: null },
    display_name: "Busan",
    lat: 0,
    local_date: "2026-05-14",
    local_time: "15:00",
    lon: 0,
    name: "busan",
    risk: { level: "low" },
    temp_symbol: "°C",
    ...extra,
  } as CityDetail;
}

export function runTests() {
  const busan = detail({
    airport_current: {
      obs_time: "15:00",
      source_label: "METAR",
      temp: 26,
    },
    amos: {
      runway_obs: {
        runway_pairs: [["18L", "36R"]],
        temperatures: [[25.2, 18.1]],
      },
      source: "amos",
      temp: 26,
      temp_c: 26,
      temp_source: "metar",
    },
  });
  const busanTemp = resolveMonitorTemperature(busan);
  assert.equal(busanTemp.value, 25.2);
  assert.equal(busanTemp.source, "amos_runway");

  const seoul = detail({
    airport_current: { obs_time: "15:00", temp: 27 },
    amos: {
      runway_obs: {
        runway_pairs: [["15L", "33R"], ["15R", "33L"]],
        temperatures: [[25.2, 19], [24.8, 18.8]],
      },
      source: "amos",
      temp_source: "metar",
    },
  });
  const seoulTemp = resolveMonitorTemperature(seoul);
  assert.equal(seoulTemp.value, 25);
  assert.equal(seoulTemp.source, "amos_runway_median");

  const beijing = detail({
    display_name: "Beijing",
    name: "beijing",
    amos: {
      runway_obs: {
        runway_pairs: [["18R", "36L"], ["18L", "36R"]],
        temperatures: [[20.8, null], [21.0, null]],
      },
      source: "amsc_awos",
      temp_c: 21,
      temp_source: "runway_max",
    },
  });
  const beijingTemp = resolveMonitorTemperature(beijing);
  assert.equal(beijingTemp.value, 21);
  assert.equal(beijingTemp.source, "amsc_awos_runway_max");

  const metarOnly = detail({
    airport_current: { obs_time: "15:00", temp: 30 },
    current: { temp: 29 } as CityDetail["current"],
  });
  assert.equal(resolveMonitorTemperature(metarOnly).value, 30);
}
