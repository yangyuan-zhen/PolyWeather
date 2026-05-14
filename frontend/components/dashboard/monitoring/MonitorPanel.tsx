"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useCityDetails, useDashboardActions } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import type { CityDetail, ObservationFreshness } from "@/lib/dashboard-types";
import {
  getMonitorFreshnessLevel,
  getObservationFreshness,
  shouldRefreshMonitorCity,
  type MonitorFreshnessLevel,
} from "@/lib/source-freshness";
import {
  getMonitorRefreshRequest,
  MONITOR_REFRESH_INTERVAL_MS,
  type MonitorRefreshTrigger,
} from "./monitor-refresh-policy";
import { resolveMonitorTemperature } from "./monitor-temperature";

/* ── Constants ───────────────────────────────────────────────── */
const MONITOR_KEYS = [
  "seoul", "busan", "tokyo", "ankara", "helsinki", "amsterdam",
  "istanbul", "paris", "hong kong", "lau fau shan", "taipei",
  "new york", "los angeles", "chicago", "denver", "atlanta",
  "miami", "san francisco", "houston", "dallas", "austin", "seattle",
] as const;

type MonitorKey = (typeof MONITOR_KEYS)[number];
type MonitorRefreshRequest = ReturnType<typeof getMonitorRefreshRequest>;

const CONCURRENCY = 6;

/* ── Helpers ─────────────────────────────────────────────────── */
type Lang = { isEn: boolean };
function t(en: string, zh: string, { isEn }: Lang) { return isEn ? en : zh; }

type Freshness = MonitorFreshnessLevel;

function freshnessDotTitle(
  level: Freshness,
  ageMin: number | null | undefined,
  isEn: boolean,
  freshness?: ObservationFreshness | null,
): string {
  const age = ageMin != null ? (isEn ? `${ageMin} min ago` : `${ageMin} 分钟前`) : "--";
  const source = freshness?.source_label ? `${freshness.source_label} · ` : "";
  const cadence =
    freshness?.native_update_interval_sec != null
      ? Math.round(freshness.native_update_interval_sec / 60)
      : null;
  const cadenceText =
    cadence != null
      ? isEn
        ? ` · native cadence ${cadence} min`
        : ` · 源端约 ${cadence} 分钟更新`
      : "";
  if (isEn) {
    return level === "fresh" ? `${source}Fresh · ${age}${cadenceText}` :
           level === "aging" ? `${source}Waiting / aging · ${age}${cadenceText}` :
           level === "stale" ? `${source}Stale · ${age}${cadenceText}` : `${source}Unknown age${cadenceText}`;
  }
  return level === "fresh" ? `${source}数据新鲜 · ${age}${cadenceText}` :
         level === "aging" ? `${source}等待源端更新 / 数据变旧 · ${age}${cadenceText}` :
         level === "stale" ? `${source}数据陈旧 · ${age}${cadenceText}` : `${source}更新时间未知${cadenceText}`;
}

/* ── Audio alert (Web Audio API, no external file needed) ────── */
function playNewHighBeep(): void {
  try {
    const ctx = new AudioContext();
    // Two-tone rising beep: signals a new temperature high
    const tones = [
      { freq: 880,  start: 0,    dur: 0.12, peak: 0.40 },
      { freq: 1100, start: 0.15, dur: 0.18, peak: 0.55 },
    ];
    for (const { freq, start, dur, peak } of tones) {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0,    ctx.currentTime + start);
      g.gain.linearRampToValueAtTime(peak,  ctx.currentTime + start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.01);
    }
    setTimeout(() => ctx.close(), 600);
  } catch {
    // AudioContext may be blocked before a user gesture — silently ignore
  }
}

function trendClass(detail: CityDetail | undefined, key?: string): "rising" | "falling" | "flat" {
  const { source } = resolveMonitorTemperature(detail);
  // Runway surface temp vs air temp comparison is meaningless
  if (source === "amos_runway_median" || source === "amos_runway") return "flat";
  const cur = resolveMonitorTemperature(detail).value;
  const max = resolveMaxSoFar(detail, key);
  if (cur != null && max != null && cur >= max + 0.3) return "rising";
  if (cur != null && max != null && cur < max - 1.0) return "falling";
  return "flat";
}

function trendSymbol(tr: "rising" | "falling" | "flat") {
  return tr === "rising" ? "↑" : tr === "falling" ? "↓" : "→";
}

/**
 * Resolve today's observed high temperature.
 *
 * HKO cities (Hong Kong / Lau Fau Shan):
 *   current.max_so_far from HKO observatory IS the settlement anchor.
 *   airport_current (METAR) is secondary — prefer HKO first.
 *
 * All other cities:
 *   airport_current.max_so_far is the authoritative settlement reference.
 */
function resolveMaxSoFar(
  detail: CityDetail | undefined,
  key?: string,
): number | null {
  // HKO: settlement station takes priority over airport METAR
  if (key === "hong kong" || key === "lau fau shan") {
    const hko = detail?.current?.max_so_far ?? null;
    if (hko != null) return Math.round(hko * 10) / 10;
  }

  const v = detail?.airport_current?.max_so_far ?? null;
  if (v != null) return Math.round(v * 10) / 10;

  // Non-HKO fallback to current.max_so_far
  if (key !== "hong kong" && key !== "lau fau shan") {
    const cur = detail?.current?.max_so_far ?? null;
    if (cur != null) return Math.round(cur * 10) / 10;
  }

  return null;
}

/* ── Airport names ───────────────────────────────────────────── */
const AIRPORT_NAMES: Record<string, { en: string; zh: string }> = {
  seoul:           { en: "Incheon",      zh: "仁川" },
  busan:           { en: "Gimhae",       zh: "金海" },
  tokyo:           { en: "Haneda",       zh: "羽田" },
  ankara:          { en: "Esenboğa",     zh: "埃森博阿" },
  helsinki:        { en: "Vantaa",       zh: "万塔" },
  amsterdam:       { en: "Schiphol",     zh: "史基浦" },
  istanbul:        { en: "Airport",      zh: "机场站" },
  paris:           { en: "Le Bourget",   zh: "勒布尔热" },
  "hong kong":     { en: "Observatory",  zh: "天文台" },
  "lau fau shan":  { en: "Lau Fau Shan",zh: "流浮山" },
  taipei:          { en: "Songshan",     zh: "松山" },
  "new york":      { en: "LaGuardia",    zh: "拉瓜迪亚" },
  "los angeles":   { en: "LAX",          zh: "洛杉矶" },
  chicago:         { en: "O'Hare",       zh: "奥黑尔" },
  denver:          { en: "Buckley",      zh: "巴克利" },
  atlanta:         { en: "Hartsfield",   zh: "哈茨菲尔德" },
  miami:           { en: "MIA",          zh: "迈阿密" },
  "san francisco": { en: "SFO",          zh: "旧金山" },
  houston:         { en: "Hobby",        zh: "霍比" },
  dallas:          { en: "Love Field",   zh: "勒芙机场" },
  austin:          { en: "Bergstrom",    zh: "伯格斯特罗姆" },
  seattle:         { en: "SeaTac",       zh: "西塔克" },
};

function airportLabel(key: string, isEn: boolean) {
  const e = AIRPORT_NAMES[key];
  return e ? (isEn ? e.en : e.zh) : "";
}

/**
 * Cities whose observation data comes from HKO ground stations,
 * NOT ICAO airport METAR. Display "天文台观测 / HKO Obs" for these.
 */
const HKO_OBS_CITIES = new Set<MonitorKey>(["hong kong", "lau fau shan"]);

const SOURCE_LABELS: Record<string, { en: string; zh: string }> = {
  amos_runway_median: { en: "AMOS Runway", zh: "AMOS 跑道温度" },
  amos_runway: { en: "AMOS Runway", zh: "AMOS 跑道温度" },
  amos: { en: "AMOS", zh: "AMOS" },
  madis_hfmetar: { en: "NOAA MADIS", zh: "NOAA MADIS" },
  mgm: { en: "MGM", zh: "MGM" },
  jma_amedas: { en: "JMA AMeDAS", zh: "JMA AMeDAS" },
  fmi: { en: "FMI", zh: "FMI" },
  knmi: { en: "KNMI", zh: "KNMI" },
  sg_mss: { en: "Singapore MSS", zh: "新加坡 MSS" },
  airport_current: { en: "Airport METAR", zh: "机场报文" },
  current: { en: "Obs", zh: "观测" },
};

function resolveSourceLabel(
  detail: CityDetail | undefined,
  key: MonitorKey,
  isEn: boolean,
): string {
  // Use airport_primary source label from high-freq pipeline
  const apSource = detail?.airport_primary?.source_code;
  if (apSource && SOURCE_LABELS[apSource]) {
    return isEn ? SOURCE_LABELS[apSource].en : SOURCE_LABELS[apSource].zh;
  }
  // Use temperature resolution source
  const { source } = resolveMonitorTemperature(detail);
  if (source && SOURCE_LABELS[source]) {
    return isEn ? SOURCE_LABELS[source].en : SOURCE_LABELS[source].zh;
  }
  if (HKO_OBS_CITIES.has(key)) return isEn ? "HKO Obs" : "天文台观测";
  return isEn ? "Airport METAR" : "机场报文";
}

/* ── Skeleton Card ───────────────────────────────────────────── */
function SkeletonCard({ label }: { label: string }) {
  return (
    <div className="monitor-skeleton-card" aria-label={label}>
      <div className="monitor-skeleton-line" style={{ height: 13, width: "42%", marginBottom: 14 }} />
      <div className="monitor-skeleton-line" style={{ height: 50, width: "52%", marginBottom: 16 }} />
      <div className="monitor-skeleton-line" style={{ height: 11, width: "68%" }} />
      <div className="monitor-skeleton-line" style={{ height: 11, width: "38%", marginTop: 8 }} />
    </div>
  );
}

/* ── Freshness dot ───────────────────────────────────────────── */
function FreshnessDot({ level, title }: { level: Freshness; title: string }) {
  return (
    <span
      className={`monitor-freshness-dot ${level}`}
      title={title}
      aria-label={title}
    />
  );
}

/* ── Main component ──────────────────────────────────────────── */
export default function MonitorPanel({
  onCityClick,
}: {
  onCityClick?: (cityName: string) => void;
}) {
  const { ensureCityDetail } = useDashboardActions();
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const lang: Lang = { isEn };

  const { cityDetailsByName: details } = useCityDetails();
  const detailsRef = useRef(details);
  detailsRef.current = details;
  const ensureCityDetailRef = useRef(ensureCityDetail);

  useEffect(() => {
    ensureCityDetailRef.current = ensureCityDetail;
  }, [ensureCityDetail]);

  const [time, setTime] = useState("");
  const [fetchingKeys, setFetchingKeys] = useState<ReadonlySet<string>>(new Set());
  const cancelledRef = useRef(false);
  const globalFetchingRef = useRef(false);

  /* Flash state: tracks cities whose temperature just changed */
  const [flashingKeys, setFlashingKeys] = useState<ReadonlySet<string>>(new Set());
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const prevTempsRef = useRef<Partial<Record<MonitorKey, number>>>({});
  const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [notify, setNotify] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("monitor_notify") !== "off";
  });

  /* Detect temperature changes → trigger per-city flash + update lastRefreshed */
  useEffect(() => {
    const changed: MonitorKey[] = [];
    for (const key of MONITOR_KEYS) {
      const detail = details[key];
      const cur = resolveMonitorTemperature(detail).value;
      const prev = prevTempsRef.current[key];
      if (cur != null && prev != null && cur !== prev) changed.push(key);
      if (cur != null) prevTempsRef.current[key] = cur;
    }
    if (changed.length === 0) return;

    setLastRefreshed(
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
    setFlashingKeys((prev) => new Set([...prev, ...changed]));
    for (const key of changed) {
      clearTimeout(flashTimersRef.current[key]);
      flashTimersRef.current[key] = setTimeout(() => {
        setFlashingKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
      }, 900);
    }
  }, [details]);

  /* Per-city fetch with loading-key tracking */
  const fetchCity = useCallback(
    async (key: MonitorKey, request: MonitorRefreshRequest) => {
      setFetchingKeys((prev) => new Set([...prev, key]));
      try {
        await ensureCityDetailRef.current(key, request.force, request.depth);
      } catch {
        /* individual city errors are shown as "--" in the card */
      } finally {
        setFetchingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  /* Refresh all cities, sorted by staleness (most stale first). */
  const refreshAll = useCallback(
    async (trigger: MonitorRefreshTrigger) => {
      if (globalFetchingRef.current) return;
      globalFetchingRef.current = true;
      const request = getMonitorRefreshRequest(trigger);

      const now = new Date();
      /* Sort keys: cities with no data first, then by source-aware freshness/staleness. */
      const dueKeys = [...MONITOR_KEYS].filter((key) =>
        shouldRefreshMonitorCity({
          detail: detailsRef.current[key],
          now,
          trigger,
        }),
      );

      const sorted = dueKeys.sort((a, b) => {
        const d = detailsRef.current;
        const freshA = getObservationFreshness(d[a]);
        const freshB = getObservationFreshness(d[b]);
        const ageA =
          freshA?.age_sec != null
            ? freshA.age_sec / 60
            : d[a]?.airport_current?.obs_age_min ?? Infinity;
        const ageB =
          freshB?.age_sec != null
            ? freshB.age_sec / 60
            : d[b]?.airport_current?.obs_age_min ?? Infinity;
        return ageB - ageA; // stale first
      });

      const queue = sorted as MonitorKey[];
      if (queue.length === 0) {
        globalFetchingRef.current = false;
        return;
      }
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0) {
          if (cancelledRef.current) return;
          const key = queue.shift();
          if (!key) break;
          await fetchCity(key, request);
        }
      });
      await Promise.allSettled(workers);

      globalFetchingRef.current = false;
      setLastRefreshed(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      );
    },
    [fetchCity],
  );

  useEffect(() => {
    cancelledRef.current = false;
    void refreshAll("initial");
    const timer = setInterval(() => {
      if (!document.hidden) void refreshAll("interval");
    }, MONITOR_REFRESH_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
    };
  }, [refreshAll]);

  /* City list sorted by current temp descending */
  const sorted = useMemo(() => {
    return [...MONITOR_KEYS]
      .map((k) => ({ key: k, detail: details[k] }))
      .sort((a, b) => {
        const ta = resolveMonitorTemperature(a.detail).value;
        const tb = resolveMonitorTemperature(b.detail).value;
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1;
        if (tb == null) return -1;
        return tb - ta;
      });
  }, [details]);

  /* Summary counts for the header */
  const loadedCount = useMemo(
    () => MONITOR_KEYS.filter((k) => details[k] != null).length,
    [details],
  );
  const totalCount = MONITOR_KEYS.length;
  const allLoaded = loadedCount === totalCount;

  const toggleNotify = () => {
    const next = !notify;
    setNotify(next);
    localStorage.setItem("monitor_notify", next ? "on" : "off");
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  /* Audio alert when current temp exceeds today's observed high by ≥ 0.3 °C */
  useEffect(() => {
    if (!notify) return;
    const today = new Date().toDateString();
    let alerted: Record<string, unknown> = {};
    try { alerted = JSON.parse(localStorage.getItem("monitor_alerted_highs") || "{}"); } catch {}
    if (alerted._day !== today) alerted = { _day: today };

    for (const { key, detail } of sorted) {
      const { source, value: cur } = resolveMonitorTemperature(detail);
      // Skip runway cities: runway surface temp ≠ air temp
      if (source === "amos_runway_median" || source === "amos_runway") continue;
      const max = resolveMaxSoFar(detail, key);
      if (cur != null && max != null && cur >= max + 0.3) {
        // Key: city + rounded temp, so we only beep once per 0.1°C step
        const id = `${key}|${(Math.round(cur * 10) / 10).toFixed(1)}`;
        if (!alerted[id]) {
          alerted[id] = true;
          localStorage.setItem("monitor_alerted_highs", JSON.stringify(alerted));
          playNewHighBeep();
        }
      }
    }
  }, [sorted, notify]);

  /* ── Render ── */
  return (
    <div className="monitor-panel">
      {/* Header */}
      <div className="monitor-header">
        <div>
          <h2 className="monitor-title">
            {t("🔥 Market Monitor", "🔥 市场监控", lang)}
          </h2>
          {!allLoaded && (
            <p className="monitor-load-progress">
              {isEn
                ? `Loading ${loadedCount} / ${totalCount} cities…`
                : `正在加载 ${loadedCount} / ${totalCount} 个城市…`}
            </p>
          )}
        </div>
        <div className="monitor-controls">
          {fetchingKeys.size > 0 && (
            <span className="monitor-syncing-badge">
              <span className="monitor-loading-dot" />
              {isEn ? `Syncing ${fetchingKeys.size}` : `同步中 ${fetchingKeys.size}`}
            </span>
          )}
          <button
            className={`monitor-notify-btn${notify ? "" : " muted"}`}
            onClick={toggleNotify}
            title={notify
              ? t("Disable new-high alert", "关闭新高提醒", lang)
              : t("Enable new-high alert", "开启新高提醒", lang)}
          >
            {notify ? "🔔" : "🔕"}
          </button>
          {lastRefreshed && (
            <span className="monitor-last-refreshed" title={isEn ? "Last data refresh" : "上次数据刷新"}>
              {isEn ? `↻ ${lastRefreshed}` : `↻ ${lastRefreshed}`}
            </span>
          )}
          <span className="monitor-time">{time}</span>
        </div>
      </div>

      {/* Freshness legend */}
      <div className="monitor-legend">
        <span className="monitor-legend-item">
          <span className="monitor-freshness-dot fresh" />
          {t("< 20 min", "< 20 分", lang)}
        </span>
        <span className="monitor-legend-item">
          <span className="monitor-freshness-dot aging" />
          {t("20–45 min", "20–45 分", lang)}
        </span>
        <span className="monitor-legend-item">
          <span className="monitor-freshness-dot stale" />
          {t("> 45 min", "> 45 分", lang)}
        </span>
      </div>

      {/* Card grid — progressive: show skeleton only for cities not yet loaded */}
      <div className="monitor-grid">
        {sorted.map(({ key, detail }) => {
          const isRefreshing = fetchingKeys.has(key);

          /* City not yet loaded at all → skeleton */
          if (!detail) {
            return <SkeletonCard key={key} label={key} />;
          }

          const ac = detail.airport_current;
          const tempInfo = resolveMonitorTemperature(detail);
          const cur = tempInfo.value;
          const curSource = tempInfo.source;
          const isRunwayTemp = curSource === "amos_runway_median" || curSource === "amos_runway";
          const max = resolveMaxSoFar(detail, key);          // HKO cities fall back to current.max_so_far
          const mtt = ac?.max_temp_time ?? detail.current?.max_temp_time ?? null;
          const freshnessInfo = getObservationFreshness(detail);
          const obs =
            freshnessInfo?.observed_at_local ??
            ac?.obs_time ??
            detail.current?.obs_time ??
            detail.local_time ??
            "";
          const age =
            freshnessInfo?.age_sec != null
              ? Math.round(freshnessInfo.age_sec / 60)
              : ac?.obs_age_min ?? null;
          const freshness = getMonitorFreshnessLevel(freshnessInfo, age);
          const tempSymbol = detail.temp_symbol || "°C";  // °F for US cities
          // Runway surface temp vs air temp comparison is meaningless
          const newHigh = !isRunwayTemp && cur != null && max != null && cur >= max + 0.3;
          const warm = !newHigh && !isRunwayTemp && cur != null && cur >= 30;
          const tr = trendClass(detail, key);
          const rwPairs = detail.amos?.runway_obs?.runway_pairs ?? [];
          const rwTemps = detail.amos?.runway_obs?.temperatures ?? [];
          const isFlashing = flashingKeys.has(key);

          return (
            <div
              key={key}
              className={[
                "monitor-card",
                newHigh ? "new-high" : "",
                isRefreshing ? "refreshing" : "",
                onCityClick ? "clickable" : "",
              ].filter(Boolean).join(" ")}
              role={onCityClick ? "button" : undefined}
              tabIndex={onCityClick ? 0 : undefined}
              onClick={onCityClick ? () => onCityClick(key) : undefined}
              onKeyDown={onCityClick ? (e) => { if (e.key === "Enter" || e.key === " ") onCityClick(key); } : undefined}
              title={onCityClick ? (isEn ? `Open ${detail.display_name || key} decision card` : `打开 ${detail.display_name || key} 决策卡`) : undefined}
            >
              {/* Refresh progress bar */}
              {isRefreshing && <div className="monitor-refresh-bar" />}

              {/* Card header */}
              <div className={`monitor-card-head${isFlashing ? " flashed" : ""}`}>
                <span className="monitor-city-name">{detail.display_name || key}</span>
                <span className="monitor-airport-name">/ {airportLabel(key, isEn)}</span>
                <FreshnessDot
                  level={freshness}
                  title={freshnessDotTitle(freshness, age, isEn, freshnessInfo)}
                />
                {newHigh && (
                  <span className="monitor-new-high-badge">
                    {t("◆ New High", "◆新高", lang)}
                  </span>
                )}
                <span className="monitor-obs-time">{obs}</span>
              </div>

              {/* Temperature — runway cities skip the large value (runway surface ≠ air temp) */}
              <div className="monitor-temp-display">
                {isRunwayTemp ? (
                  <span className="monitor-temp-runway">
                    {t("Runway Temp", "跑道温度", lang)}
                  </span>
                ) : cur != null ? (
                  <>
                    <span className={`monitor-temp-value${newHigh ? " new-high" : warm ? " warm" : ""}${isFlashing ? " flashed" : ""}`}>
                      {Number.isInteger(cur) ? cur.toFixed(0) : cur.toFixed(1)}
                    </span>
                    <span className="monitor-temp-unit">{tempSymbol}</span>
                  </>
                ) : (
                  <span className="monitor-temp-missing">--</span>
                )}
              </div>

              {/* Stats */}
              <div className="monitor-stats">
                <div className="monitor-high-row">
                  <span className="monitor-stat-label">{t("Today's High", "今日实测高温", lang)}</span>
                  {max != null ? (
                    <>
                      <span className="monitor-high-value">{Number.isInteger(max) ? max.toFixed(0) : max.toFixed(1)}{tempSymbol}</span>
                      {mtt && <span className="monitor-high-time">{mtt}</span>}
                    </>
                  ) : (
                    <span className="monitor-stat-missing">--</span>
                  )}
                  <span className={`monitor-trend ${tr}`}>{trendSymbol(tr)}</span>
                </div>
                <div className="monitor-obs-row">
                  <span className="monitor-stat-label">
                    {resolveSourceLabel(detail, key, isEn)}
                  </span>
                  <span className={`monitor-obs-age ${freshness}`}>
                    {age != null ? (
                      age < 60
                        ? (isEn ? `${age} min ago` : `${age} 分钟未更新`)
                        : (isEn
                            ? `⚠ last ${obs || "?"}`
                            : `⚠ 最后报文 ${obs || "--"}`)
                    ) : (
                      <span className="monitor-stat-missing">--</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Runway temps */}
              {rwPairs.length > 0 && rwTemps.length > 0 && (
                <>
                  <div className="monitor-divider" />
                  {rwPairs.map((p, i) => {
                    const temp = rwTemps[i]?.[0];
                    if (temp == null) return null;
                    return (
                      <div key={i} className="monitor-rw-row">
                        <span className="monitor-rw-label">{p[0]}/{p[1]}</span>
                        <span className="monitor-rw-temp">{temp.toFixed(1)}°C</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
