"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCityDetails, useDashboardActions } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import type { CityDetail } from "@/lib/dashboard-types";

const RUNWAY_OBSERVATION_CITIES = [
  { key: "seoul", zh: "首尔", en: "Seoul", icao: "RKSI", sourceLabel: "AMOS" },
  { key: "busan", zh: "釜山", en: "Busan", icao: "RKPK", sourceLabel: "AMOS" },
  { key: "beijing", zh: "北京", en: "Beijing", icao: "ZBAA", sourceLabel: "AMSC AWOS" },
  { key: "shanghai", zh: "上海", en: "Shanghai", icao: "ZSPD", sourceLabel: "AMSC AWOS" },
  { key: "guangzhou", zh: "广州", en: "Guangzhou", icao: "ZGGG", sourceLabel: "AMSC AWOS" },
  { key: "shenzhen", zh: "深圳", en: "Shenzhen", icao: "ZGSZ", sourceLabel: "AMSC AWOS" },
  { key: "qingdao", zh: "青岛", en: "Qingdao", icao: "ZSQD", sourceLabel: "AMSC AWOS" },
  { key: "chengdu", zh: "成都", en: "Chengdu", icao: "ZUUU", sourceLabel: "AMSC AWOS" },
  { key: "chongqing", zh: "重庆", en: "Chongqing", icao: "ZUCK", sourceLabel: "AMSC AWOS" },
  { key: "wuhan", zh: "武汉", en: "Wuhan", icao: "ZHHH", sourceLabel: "AMSC AWOS" },
] as const;

function formatTemp(value: number | null | undefined, symbol = "°C") {
  return value == null || !Number.isFinite(Number(value))
    ? "-"
    : `${Number(value).toFixed(1)}${symbol}`;
}

function getRunwayRows(detail?: CityDetail | null) {
  return detail?.amos?.runway_obs?.point_temperatures ?? [];
}

function getRunwayPairRows(detail?: CityDetail | null) {
  const runway_pairs = detail?.amos?.runway_obs?.runway_pairs ?? [];
  const runway_temps =
    detail?.amos?.runway_obs?.temperatures ??
    detail?.amos?.runway_temps ??
    [];
  return runway_pairs.map(([from, to], index) => ({
    label: `${from}/${to}`,
    temp: runway_temps[index]?.[0] ?? null,
    dew: runway_temps[index]?.[1] ?? null,
  }));
}

function sourceIsAmsc(detail?: CityDetail | null) {
  return detail?.amos?.source === "amsc_awos";
}

function RunwayCityCard({
  detail,
  isEn,
  label,
}: {
  detail?: CityDetail | null;
  isEn: boolean;
  label: (typeof RUNWAY_OBSERVATION_CITIES)[number];
}) {
  const rows = getRunwayRows(detail);
  const pairRows = getRunwayPairRows(detail);
  const tempSymbol = detail?.temp_symbol || "°C";
  const range = detail?.amos?.runway_temp_range;
  const obsLocal =
    detail?.amos?.observation_time_local || detail?.amos?.observation_time;
  const hasPointRows = sourceIsAmsc(detail) && rows.length > 0;
  const hasPairRows = pairRows.some((row) => row.temp != null || row.dew != null);
  const hasRunwayData = hasPointRows || hasPairRows;

  return (
    <article className="monitor-card">
      <div className="monitor-card-head">
        <span className="monitor-city-name">{isEn ? label.en : label.zh}</span>
        <span className="monitor-airport-name">/ {label.icao}</span>
        <span className="monitor-obs-time">{obsLocal || "--"}</span>
      </div>

      <div className="monitor-stats">
        <div className="monitor-high-row">
          <span className="monitor-stat-label">{label.sourceLabel}</span>
          <span className="monitor-high-value">
            {range
              ? `${range[0].toFixed(1)}–${range[1].toFixed(1)}${tempSymbol}`
              : hasPairRows
                ? pairRows
                    .map((row) => row.temp)
                    .filter((value): value is number => value != null)
                    .map((value) => value.toFixed(1))
                    .join(" / ") + tempSymbol
              : "--"}
          </span>
        </div>
      </div>

      {hasRunwayData ? (
        <>
          <div className="monitor-divider" />
          {hasPointRows ? (
            <>
              <div className="monitor-rw-row">
                <span className="monitor-rw-label">{isEn ? "Runway" : "跑道"}</span>
                <span className="monitor-rw-temp">TDZ / MID / END</span>
              </div>
              {rows.map((row) => (
                <div
                  key={row.runway || `${row.tdz_temp}-${row.end_temp}`}
                  className="monitor-rw-row"
                >
                  <span className="monitor-rw-label">{row.runway || "--"}</span>
                  <span className="monitor-rw-temp">
                    {formatTemp(row.tdz_temp, tempSymbol)} /{" "}
                    {formatTemp(row.mid_temp, tempSymbol)} /{" "}
                    {formatTemp(row.end_temp, tempSymbol)}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <div className="monitor-rw-row">
              <span className="monitor-rw-label">{isEn ? "Runway" : "跑道"}</span>
              <span className="monitor-rw-temp">{isEn ? "Temp / Dew" : "温度 / 露点"}</span>
            </div>
          )}
          {hasPairRows &&
            pairRows.map((row) => (
              <div key={row.label} className="monitor-rw-row">
                <span className="monitor-rw-label">{row.label}</span>
                <span className="monitor-rw-temp">
                  {formatTemp(row.temp, tempSymbol)} / {formatTemp(row.dew, tempSymbol)}
                </span>
              </div>
            ))}
        </>
      ) : (
        <div className="scan-empty-state compact">
          {isEn
            ? `No ${label.sourceLabel} runway observation loaded yet.`
            : `暂无 ${label.sourceLabel} 跑道观测。`}
        </div>
      )}
    </article>
  );
}

export function RunwayObservationsPanel() {
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const { cityDetailsByName } = useCityDetails();
  const { ensureCityDetail } = useDashboardActions();
  const loadAll = useCallback(
    async () => {
      await Promise.allSettled(
        RUNWAY_OBSERVATION_CITIES.map((city) =>
          ensureCityDetail(city.key, false, "panel"),
        ),
      );
    },
    [ensureCityDetail],
  );

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void loadAll();
    intervalRef.current = setInterval(() => {
      void Promise.allSettled(
        RUNWAY_OBSERVATION_CITIES.map((city) =>
          ensureCityDetail(city.key, true, "panel"),
        ),
      );
    }, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadAll, ensureCityDetail]);

  const cards = useMemo(
    () =>
      RUNWAY_OBSERVATION_CITIES.map((city) => ({
        ...city,
        detail: cityDetailsByName[city.key],
      })),
    [cityDetailsByName],
  );

  return (
    <div className="monitor-panel runway-observations-panel">
      <div className="monitor-toolbar">
        <div className="monitor-title">
          {isEn ? "Runway Observations" : "跑道观测"}
        </div>
      </div>

      <div className="monitor-grid">
        {cards.map((city) => (
          <RunwayCityCard
            key={city.key}
            detail={city.detail}
            isEn={isEn}
            label={city}
          />
        ))}
      </div>
    </div>
  );
}
