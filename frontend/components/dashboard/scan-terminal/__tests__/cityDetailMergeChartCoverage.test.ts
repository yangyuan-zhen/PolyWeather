import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "hooks", "useDashboardStore.tsx"),
    "utf8",
  );

  assert(
    source.includes("function pickRicherHourly"),
    "city detail merge should have an explicit hourly-series preservation helper",
  );
  assert(
    /hourly:\s*pickRicherHourly\(\s*current\.hourly,\s*incoming\.hourly\s*\)/.test(
      source,
    ),
    "deep-analysis refresh must not let sparse incoming hourly data overwrite chart-capable cached hourly data",
  );
  assert(
    source.includes("function pickRicherObservationSeries"),
    "city detail merge should preserve chart observation series when refresh payload is sparse",
  );
  assert(
    /metar_today_obs:\s*pickRicherObservationSeries\(\s*current\.metar_today_obs,\s*incoming\.metar_today_obs,?\s*\)/.test(
      source,
    ),
    "deep-analysis refresh must not wipe METAR observation points used by the intraday path chart",
  );
  assert(
    /settlement_today_obs:\s*pickRicherObservationSeries\(\s*current\.settlement_today_obs,\s*incoming\.settlement_today_obs,?\s*\)/.test(
      source,
    ),
    "deep-analysis refresh must not wipe settlement observation points used by the intraday path chart",
  );
  assert(
    /trend:\s*mergeTrendInfo\(\s*current\.trend,\s*incoming\.trend\s*\)/.test(source),
    "deep-analysis refresh must merge trend.recent instead of replacing it with sparse trend payloads",
  );
}
