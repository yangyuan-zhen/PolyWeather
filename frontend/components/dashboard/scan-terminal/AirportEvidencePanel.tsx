"use client";

import type { CityDetail } from "@/lib/dashboard-types";
import { getDisplayAirportPrimary } from "@/lib/airport-observation-display";
import { formatTemperatureValue } from "@/lib/temperature-utils";

// Settlement runway mapping — matches Polymarket settlement anchors
const SETTLEMENT_RUNWAY_PAIRS: Record<string, Array<[string, string]>> = {
  shanghai: [["17L", "35R"]],
  beijing: [["01", "19"]],
  guangzhou: [["02L", "20R"]],
  chengdu: [["02L", "20R"]],
  chongqing: [["02L", "20R"]],
  wuhan: [["04", "22"]],
  seoul: [["15R", "33L"]],
};

function normalizeRunwayLabel(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCityKey(value?: string | null) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function pairKey(pair: [string, string]) {
  return pair.map(normalizeRunwayLabel).sort().join("/");
}

function toFiniteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatObsTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("T")) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return `${String(parsed.getUTCHours()).padStart(2, "0")}:${String(
        parsed.getUTCMinutes(),
      ).padStart(2, "0")}Z`;
    }
  }
  return raw.length >= 16 && raw[10] === " " ? raw.slice(11, 16) : raw;
}

function buildRunwayEvidence(detail: CityDetail | null) {
  if (!detail) return null;
  const cityKey = normalizeCityKey(detail.name) || normalizeCityKey(detail.display_name);
  const settlementPairs = SETTLEMENT_RUNWAY_PAIRS[cityKey] || [];
  const settlementKeys = new Set(settlementPairs.map(pairKey));
  const runwayObs = detail.amos?.runway_obs || {};
  const runwayPairs = runwayObs.runway_pairs || [];
  const runwayTemps = runwayObs.temperatures || [];
  const pointTemps = runwayObs.point_temperatures || [];
  const rows: Array<{
    label: string;
    maxTemp: number;
    values: number[];
    isSettlement: boolean;
  }> = [];

  runwayPairs.forEach((rawPair, index) => {
    const pair = rawPair as [string, string];
    if (!Array.isArray(pair) || pair.length < 2) return;
    const isSettlement = settlementKeys.has(pairKey(pair));
    const values = [
      ...(Array.isArray(runwayTemps[index]) ? runwayTemps[index] : []),
      toFiniteNumber(pointTemps[index]?.tdz_temp),
      toFiniteNumber(pointTemps[index]?.mid_temp),
      toFiniteNumber(pointTemps[index]?.end_temp),
    ].filter((value): value is number => Number.isFinite(value));
    if (!values.length) return;
    rows.push({
      label: `${normalizeRunwayLabel(pair[0])}/${normalizeRunwayLabel(pair[1])}`,
      maxTemp: Math.max(...values),
      values,
      isSettlement,
    });
  });

  if (!rows.length) return null;
  return {
    observedAt:
      formatObsTime(detail.amos?.observation_time_local) ||
      formatObsTime(detail.amos?.observation_time),
    rows,
    sourceLabel: detail.amos?.source_label || detail.amos?.source || "AMOS",
  };
}

export function AirportEvidencePanel({
  detail,
  isEn,
}: {
  detail: CityDetail | null;
  isEn: boolean;
}) {
  const airportPrimary = getDisplayAirportPrimary(detail);
  const airportCurrent = detail?.airport_current;
  const station = airportPrimary || airportCurrent || null;
  const runwayEvidence = buildRunwayEvidence(detail);
  const tempSymbol = detail?.temp_symbol || "°C";
  if (!station && !runwayEvidence) return null;

  return (
    <section className="scan-ai-city-section scan-airport-evidence">
      <div className="scan-ai-city-section-head">
        <div>
          <span className="scan-ai-city-kicker">
            {isEn ? "Airport live evidence" : "机场实时证据"}
          </span>
          <h4>{isEn ? "Airport / runway observations" : "机场 / 跑道观测"}</h4>
        </div>
      </div>
      <div className="scan-airport-evidence-grid">
        {station ? (
          <div className="scan-airport-evidence-card">
            <span>{isEn ? "Airport station" : "机场主站"}</span>
            <b>
              {station.temp != null && Number.isFinite(Number(station.temp))
                ? formatTemperatureValue(Number(station.temp), tempSymbol, { digits: 1 })
                : "--"}
            </b>
            <small>
              {[station.station_label || station.station_code, station.source_label || "METAR", formatObsTime(station.obs_time || station.report_time)]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </div>
        ) : null}
        {runwayEvidence?.rows.map((row) => (
          <div
            className={`scan-airport-evidence-card runway${row.isSettlement ? " settlement" : ""}`}
            key={row.label}
          >
            <span>
              {row.isSettlement
                ? isEn ? "★ Settlement runway" : "★ 结算跑道"
                : isEn ? "Runway" : "跑道"}
            </span>
            <b>{formatTemperatureValue(row.maxTemp, tempSymbol, { digits: 1 })}</b>
            <small>
              {[row.label, runwayEvidence.sourceLabel, runwayEvidence.observedAt]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
