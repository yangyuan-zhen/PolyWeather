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

function trendClass(detail: CityDetail | undefined): "rising" | "falling" | "flat" {
  if (!detail?.airport_current) return "flat";
  const ac = detail.airport_current;
  const cur = ac.temp ?? detail.current?.temp ?? null;
  const max = ac.max_so_far ?? null;
  if (cur != null && max != null && cur >= max + 0.3) return "rising";
  if (cur != null && max != null && cur < max - 1.0) return "falling";
  return "flat";
}

function trendSymbol(tr: "rising" | "falling" | "flat") {
  return tr === "rising" ? "↑" : tr === "falling" ? "↓" : "→";
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
export default function MonitorPanel() {
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

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [notify, setNotify] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("monitor_notify") !== "off";
  });

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

  /* Browser notifications for new highs */
  useEffect(() => {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = new Date().toDateString();
    let notified: Record<string, unknown> = {};
    try { notified = JSON.parse(localStorage.getItem("monitor_notified_highs") || "{}"); } catch {}
    if (notified._day !== today) notified = { _day: today };

    for (const { key, detail } of sorted) {
      const ac = detail?.airport_current;
      const cur = ac?.temp ?? detail?.current?.temp ?? null;
      const max = ac?.max_so_far ?? null;
      if (cur != null && max != null && cur >= max + 0.3) {
        const id = `${key}|${cur}`;
        if (!notified[id]) {
          notified[id] = true;
          localStorage.setItem("monitor_notified_highs", JSON.stringify(notified));
          const name = detail?.display_name || key;
          new Notification(isEn ? `🔴 New High — ${name}` : `🔴 新高 — ${name}`, {
            body: isEn ? `${cur}°C · New daily high.` : `${cur}°C · 今日新高。`,
            tag: id,
            requireInteraction: true,
          });
        }
      }
    }
  }, [sorted, notify, isEn]);

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
              ? t("Disable alerts", "关闭提醒", lang)
              : t("Enable alerts", "开启提醒", lang)}
          >
            {notify ? "🔔" : "🔕"}
          </button>
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
          const max = ac?.max_so_far ?? null;
          const mtt = ac?.max_temp_time ?? null;
          const obs = ac?.obs_time ?? detail.local_time ?? "";
          const age = ac?.obs_age_min ?? null;
          const freshness = freshnessLevel(age);
          const newHigh = cur != null && max != null && cur >= max + 0.3;
          const warm = !newHigh && cur != null && cur >= 30;
          const tr = trendClass(detail);
          const rwPairs = detail.amos?.runway_obs?.runway_pairs ?? [];
          const rwTemps = detail.amos?.runway_obs?.temperatures ?? [];

          return (
            <div
              key={key}
              className={[
                "monitor-card",
                newHigh ? "new-high" : "",
                isRefreshing ? "refreshing" : "",
              ].filter(Boolean).join(" ")}
            >
              {/* Refresh progress bar */}
              {isRefreshing && <div className="monitor-refresh-bar" />}

              {/* Card header */}
              <div className="monitor-card-head">
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
                    <span className={`monitor-temp-value${newHigh ? " new-high" : warm ? " warm" : ""}`}>
                      {cur.toFixed(1)}
                    </span>
                    <span className="monitor-temp-unit">°C</span>
                  </>
                ) : (
                  <span className="monitor-temp-missing">--</span>
                )}
              </div>

              {/* Stats */}
              <div className="monitor-stats">
                <div className="monitor-high-row">
                  <span className="monitor-stat-label">{t("High", "高温", lang)}</span>
                  {max != null ? (
                    <>
                      <span className="monitor-high-value">{max.toFixed(1)}°C</span>
                      {mtt && <span className="monitor-high-time">{mtt}</span>}
                    </>
                  ) : (
                    <span className="monitor-stat-missing">--</span>
                  )}
                  <span className={`monitor-trend ${tr}`}>{trendSymbol(tr)}</span>
                </div>
                <div className="monitor-obs-row">
                  <span className="monitor-stat-label">{t("Obs", "观测", lang)}</span>
                  <span className={`monitor-obs-age ${freshness}`}>
                    {age != null
                      ? (isEn ? `${age} min ago` : `${age} 分钟前`)
                      : <span className="monitor-stat-missing">--</span>}
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
