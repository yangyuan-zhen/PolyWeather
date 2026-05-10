"use client";

import type { AmosData } from "@/lib/dashboard-types";

function runwayTempClass(temp: number | null | undefined): string {
  if (temp == null || !Number.isFinite(temp)) return "";
  if (temp >= 40) return "temp-extreme-hot";
  if (temp <= -5) return "temp-extreme-cold";
  return "";
}

export function AmosRunwayPanel({
  amos,
  isEn,
  tempSymbol,
  airportCurrent,
}: {
  amos?: AmosData | null;
  isEn: boolean;
  tempSymbol: string;
  airportCurrent?: {
    temp?: number | null;
    wind_speed_kt?: number | null;
    wind_dir?: number | null;
    pressure_hpa?: number | null;
    visibility_mi?: number | null;
    raw_metar?: string | null;
    source_label?: string | null;
    obs_time?: string | null;
    stale_for_today?: boolean | null;
  } | null;
}) {
  const runwayPairs = amos?.runway_obs?.runway_pairs;
  const runwayTemps = amos?.runway_obs?.temperatures ?? amos?.runway_temps;
  const runwayWinds = amos?.runway_obs?.wind_speeds;
  const runwayVis = amos?.runway_obs?.visibility_mor;
  const runwayRvr = amos?.runway_obs?.rvr;
  const hasAmosRunway = runwayPairs && runwayPairs.length > 0;

  // Fallback: single-card METAR observation for non-AMOS airports
  if (!hasAmosRunway) {
    if (!airportCurrent?.temp && !airportCurrent?.wind_speed_kt) return null;
    const sourceLabel = airportCurrent?.source_label || (isEn ? "METAR" : "机场报文");
    const staleNote = airportCurrent?.stale_for_today
      ? isEn ? " (stale)" : "（过旧）"
      : "";
    return (
      <div className="scan-amos-runway-panel">
        <div className="scan-ai-city-section-title">
          {isEn ? "Airport Observation" : "机场观测"} · {sourceLabel}{staleNote}
        </div>
        <div className="scan-amos-runway-grid scan-amos-single">
          <div className="scan-amos-runway-card">
            <div className={`scan-amos-runway-temp ${runwayTempClass(airportCurrent.temp)}`}>
              {airportCurrent.temp != null ? `${airportCurrent.temp.toFixed(1)}${tempSymbol}` : "--"}
            </div>
            {airportCurrent.wind_speed_kt != null ? (
              <div className="scan-amos-runway-detail">
                {isEn ? "Wind " : "风 "}
                {airportCurrent.wind_dir != null ? `${airportCurrent.wind_dir}° ` : ""}
                {airportCurrent.wind_speed_kt}kt
              </div>
            ) : null}
            {airportCurrent.pressure_hpa != null ? (
              <div className="scan-amos-runway-detail">
                QNH {airportCurrent.pressure_hpa.toFixed(1)} hPa
              </div>
            ) : null}
            {airportCurrent.visibility_mi != null ? (
              <div className="scan-amos-runway-detail">
                {isEn ? "Vis " : "能见度 "}
                {(airportCurrent.visibility_mi * 1609).toFixed(0)}m
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (!runwayPairs || runwayPairs.length === 0) return null;

  const maxItems = Math.max(
    runwayPairs.length,
    runwayTemps?.length ?? 0,
    runwayWinds?.length ?? 0,
  );
  const pairs = runwayPairs.slice(0, maxItems);

  return (
    <div className="scan-amos-runway-panel">
      <div className="scan-ai-city-section-title">
        {isEn ? "Runway Observations" : "跑道实测"} · {amos.station_label || amos.icao || ""}
        <span className="scan-amos-source-tag">
          {amos.temp_source === "metar"
            ? isEn ? "Official METAR" : "官方 METAR"
            : isEn ? "Runway median" : "跑道中位数"}
        </span>
      </div>
      <div className="scan-amos-runway-grid">
        {pairs.map(([rwyA, rwyB], idx) => {
          const temps = runwayTemps?.[idx];
          const wind = runwayWinds?.[idx];
          const vis = runwayVis?.[idx];
          const rvr = runwayRvr?.[idx];
          return (
            <div key={`${rwyA}/${rwyB}`} className="scan-amos-runway-card">
              <div className="scan-amos-runway-label">
                {rwyA}/{rwyB}
              </div>
              <div className={`scan-amos-runway-temp ${runwayTempClass(temps?.[0])}`}>
                {temps?.[0] != null ? `${temps[0].toFixed(1)}${tempSymbol}` : "--"}
                {temps?.[1] != null ? (
                  <small>
                    {isEn ? " Dew " : " 露点 "}
                    {temps[1].toFixed(1)}{tempSymbol}
                  </small>
                ) : null}
              </div>
              {vis != null && vis > 0 ? (
                <div className="scan-amos-runway-detail">
                  {isEn ? "Vis " : "能见度 "}
                  {vis >= 10000 ? (isEn ? "≥10km" : "≥10公里") : `${vis}m`}
                </div>
              ) : null}
              {rvr != null && rvr > 0 ? (
                <div className="scan-amos-runway-detail">
                  RVR {rvr >= 2000 ? "≥2000m" : `${rvr}m`}
                </div>
              ) : null}
              {wind ? (
                <div className="scan-amos-runway-detail">
                  {wind[0].toFixed(1)}kt
                  {wind[1] != null ? ` (${wind[1].toFixed(1)}–${wind[2].toFixed(1)})` : ""}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
