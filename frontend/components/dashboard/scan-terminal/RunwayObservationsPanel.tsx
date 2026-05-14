"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCityDetails, useDashboardActions } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import type { CityDetail } from "@/lib/dashboard-types";

const CHINA_RUNWAY_CITIES = [
  { key: "beijing", zh: "北京", en: "Beijing", icao: "ZBAA" },
  { key: "shanghai", zh: "上海", en: "Shanghai", icao: "ZSPD" },
  { key: "guangzhou", zh: "广州", en: "Guangzhou", icao: "ZGGG" },
  { key: "shenzhen", zh: "深圳", en: "Shenzhen", icao: "ZGSZ" },
  { key: "chengdu", zh: "成都", en: "Chengdu", icao: "ZUUU" },
  { key: "chongqing", zh: "重庆", en: "Chongqing", icao: "ZUCK" },
  { key: "wuhan", zh: "武汉", en: "Wuhan", icao: "ZHHH" },
] as const;

function formatTemp(value: number | null | undefined, symbol = "°C") {
  return value == null || !Number.isFinite(Number(value))
    ? "-"
    : `${Number(value).toFixed(1)}${symbol}`;
}

function getRunwayRows(detail?: CityDetail | null) {
  return detail?.amos?.runway_obs?.point_temperatures ?? [];
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
  label: (typeof CHINA_RUNWAY_CITIES)[number];
}) {
  const rows = getRunwayRows(detail);
  const tempSymbol = detail?.temp_symbol || "°C";
  const range = detail?.amos?.runway_temp_range;
  const obsLocal =
    detail?.amos?.observation_time_local || detail?.amos?.observation_time;
  const hasAmsc = sourceIsAmsc(detail) && rows.length > 0;

  return (
    <article className="monitor-card">
      <div className="monitor-card-head">
        <span className="monitor-city-name">{isEn ? label.en : label.zh}</span>
        <span className="monitor-airport-name">/ {label.icao}</span>
        <span className="monitor-obs-time">{obsLocal || "--"}</span>
      </div>

      <div className="monitor-stats">
        <div className="monitor-high-row">
          <span className="monitor-stat-label">AMSC AWOS</span>
          <span className="monitor-high-value">
            {range
              ? `${range[0].toFixed(1)}–${range[1].toFixed(1)}${tempSymbol}`
              : "--"}
          </span>
        </div>
      </div>

      {hasAmsc ? (
        <>
          <div className="monitor-divider" />
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
        <div className="scan-empty-state compact">
          {isEn
            ? "No AMSC runway observation loaded yet."
            : "暂无 AMSC 跑道观测。"}
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
        CHINA_RUNWAY_CITIES.map((city) =>
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
        CHINA_RUNWAY_CITIES.map((city) =>
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
      CHINA_RUNWAY_CITIES.map((city) => ({
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
