"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import type { CityDetail } from "@/lib/dashboard-types";

/* ── Constants ───────────────────────────────────────────────── */
const MONITOR_KEYS = [
  "seoul", "busan", "tokyo", "ankara", "helsinki", "amsterdam",
  "istanbul", "paris", "hong kong", "lau fau shan", "taipei",
  "new york", "los angeles", "chicago", "denver", "atlanta",
  "miami", "san francisco", "houston", "dallas", "austin", "seattle",
] as const;

type MonitorKey = (typeof MONITOR_KEYS)[number];

const CONCURRENCY = 6;
const REFRESH_INTERVAL_MS = 60_000;

/* ── Helpers ─────────────────────────────────────────────────── */
type Lang = { isEn: boolean };
function t(en: string, zh: string, { isEn }: Lang) { return isEn ? en : zh; }

type Freshness = "fresh" | "aging" | "stale" | "unknown";

function freshnessLevel(ageMin: number | null | undefined): Freshness {
  if (ageMin == null) return "unknown";
  if (ageMin < 20) return "fresh";
  if (ageMin < 45) return "aging";
  return "stale";
}

function freshnessDotTitle(level: Freshness, ageMin: number | null | undefined, isEn: boolean): string {
  const age = ageMin != null ? (isEn ? `${ageMin} min ago` : `${ageMin} 分钟前`) : "--";
  if (isEn) {
    return level === "fresh" ? `Fresh · ${age}` :
           level === "aging" ? `Aging · ${age}` :
           level === "stale" ? `Stale · ${age}` : "Unknown age";
  }
  return level === "fresh" ? `数据新鲜 · ${age}` :
         level === "aging" ? `数据变旧 · ${age}` :
         level === "stale" ? `数据陈旧 · ${age}` : "更新时间未知";
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

function trendClass(detail: CityDetail | undefined): "rising" | "falling" | "flat" {
  if (!detail?.airport_current) return "flat";
  const cur = detail.airport_current.temp ?? detail.current?.temp ?? null;
  const max = resolveMaxSoFar(detail);
  if (cur != null && max != null && cur >= max + 0.3) return "rising";
  if (cur != null && max != null && cur < max - 1.0) return "falling";
  return "flat";
}

function trendSymbol(tr: "rising" | "falling" | "flat") {
  return tr === "rising" ? "↑" : tr === "falling" ? "↓" : "→";
}

/**
 * Resolve today's observed high temperature.
 * Aligned with Telegram bot (_get_airport_daily_high):
 * only airport_current.max_so_far — no fallback.
 *
 * Exception — HKO cities (Hong Kong / Lau Fau Shan):
 * The HKO observatory IS the settlement station, so current.max_so_far
 * is equivalent to the airport obs. Use it as a fallback when
 * airport_current.max_so_far is absent.
 */
function resolveMaxSoFar(
  detail: CityDetail | undefined,
  key?: string,
): number | null {
  const v = detail?.airport_current?.max_so_far ?? null;
  if (v != null) return Math.round(v * 10) / 10;

  // HKO fallback: current.max_so_far is authoritative for HKO stations
  if (key === "hong kong" || key === "lau fau shan") {
    const hko = detail?.current?.max_so_far ?? null;
    if (hko != null) return Math.round(hko * 10) / 10;
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

function obsSourceLabel(key: MonitorKey, isEn: boolean): string {
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
  const store = useDashboardStore();
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const lang: Lang = { isEn };

  const details = store.cityDetailsByName;
  const detailsRef = useRef(details);
  detailsRef.current = details;

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
      const cur = detail?.airport_current?.temp ?? detail?.current?.temp ?? null;
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
    async (key: MonitorKey, force: boolean) => {
      setFetchingKeys((prev) => new Set([...prev, key]));
      try {
        await store.ensureCityDetail(key, force, "panel");
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
    [store.ensureCityDetail],
  );

  /* Refresh all cities, sorted by staleness (most stale first). */
  const refreshAll = useCallback(
    async (force: boolean) => {
      if (globalFetchingRef.current) return;
      globalFetchingRef.current = true;

      /* Sort keys: cities with no data first, then by obs_age_min descending */
      const sorted = [...MONITOR_KEYS].sort((a, b) => {
        const d = detailsRef.current;
        const ageA = d[a]?.airport_current?.obs_age_min ?? Infinity;
        const ageB = d[b]?.airport_current?.obs_age_min ?? Infinity;
        return ageB - ageA; // stale first
      });

      const queue = sorted as MonitorKey[];
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0) {
          if (cancelledRef.current) return;
          const key = queue.shift();
          if (!key) break;
          await fetchCity(key, force);
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
    void refreshAll(false);
    const timer = setInterval(() => {
      if (!document.hidden) void refreshAll(true);
    }, REFRESH_INTERVAL_MS);
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
        const ta = a.detail?.airport_current?.temp ?? a.detail?.current?.temp ?? null;
        const tb = b.detail?.airport_current?.temp ?? b.detail?.current?.temp ?? null;
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
      const ac  = detail?.airport_current;
      const cur = ac?.temp ?? detail?.current?.temp ?? null;
      const max = resolveMaxSoFar(detail, key);   // HKO cities fall back to current.max_so_far
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
          const cur = ac?.temp ?? detail.current?.temp ?? null;
          const max = resolveMaxSoFar(detail, key);          // HKO cities fall back to current.max_so_far
          const mtt = ac?.max_temp_time ?? detail.current?.max_temp_time ?? null;
          const obs = ac?.obs_time ?? detail.local_time ?? "";
          const age = ac?.obs_age_min ?? null;
          const freshness = freshnessLevel(age);
          const tempSymbol = detail.temp_symbol || "°C";  // °F for US cities
          const newHigh = cur != null && max != null && cur >= max + 0.3;
          const warm = !newHigh && cur != null && cur >= 30;
          const tr = trendClass(detail);
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
                  title={freshnessDotTitle(freshness, age, isEn)}
                />
                {newHigh && (
                  <span className="monitor-new-high-badge">
                    {t("◆ New High", "◆新高", lang)}
                  </span>
                )}
                <span className="monitor-obs-time">{obs}</span>
              </div>

              {/* Temperature */}
              <div className="monitor-temp-display">
                {cur != null ? (
                  <>
                    <span className={`monitor-temp-value${newHigh ? " new-high" : warm ? " warm" : ""}${isFlashing ? " flashed" : ""}`}>
                      {cur.toFixed(1)}
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
                      <span className="monitor-high-value">{max.toFixed(1)}{tempSymbol}</span>
                      {mtt && <span className="monitor-high-time">{mtt}</span>}
                    </>
                  ) : (
                    <span className="monitor-stat-missing">--</span>
                  )}
                  <span className={`monitor-trend ${tr}`}>{trendSymbol(tr)}</span>
                </div>
                <div className="monitor-obs-row">
                  <span className="monitor-stat-label">
                    {obsSourceLabel(key, isEn)}
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
