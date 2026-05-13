"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import type { CityDetail } from "@/lib/dashboard-types";

const MONITOR_KEYS = [
  "seoul", "busan", "tokyo", "ankara", "helsinki", "amsterdam",
  "istanbul", "paris", "hong kong", "lau fau shan", "taipei",
  "new york", "los angeles", "chicago", "denver", "atlanta",
  "miami", "san francisco", "houston", "dallas", "austin", "seattle",
] as const;

const MONITOR_FETCH_CONCURRENCY = 6;
const MONITOR_REFRESH_INTERVAL_MS = 60_000;
const MONITOR_FRESHNESS_TTL_MS = 45_000;

type MonitorCity = {
  key: string;
  detail: CityDetail | undefined;
};

function trendClass(detail: CityDetail | undefined): "rising" | "falling" | "flat" {
  if (!detail?.airport_current) return "flat";
  const ac = detail.airport_current;
  const cur = ac.temp ?? detail.current?.temp ?? null;
  const max = ac.max_so_far ?? null;
  if (cur != null && max != null && cur >= max + 0.3) return "rising";
  if (cur != null && max != null && cur < max - 1.0) return "falling";
  return "flat";
}

function trendSymbol(t: "rising" | "falling" | "flat"): string {
  return t === "rising" ? "↑" : t === "falling" ? "↓" : "→";
}

async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  cancelled: () => boolean,
): Promise<void> {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      if (cancelled()) return;
      const task = queue.shift();
      if (!task) break;
      try { await task(); } catch { /* individual city failures show "--" */ }
    }
  });
  await Promise.allSettled(workers);
}

let lastRefreshCompletedAt = 0;

function SkeletonCard() {
  return (
    <div className="monitor-skeleton-card">
      <div className="monitor-skeleton-line" style={{ height: 14, width: "45%", marginBottom: 14 }} />
      <div className="monitor-skeleton-line" style={{ height: 52, width: "55%", marginBottom: 16 }} />
      <div className="monitor-skeleton-line" style={{ height: 12, width: "70%" }} />
      <div className="monitor-skeleton-line" style={{ height: 12, width: "40%", marginTop: 8 }} />
    </div>
  );
}

const AIRPORT_NAMES: Record<string, string> = {
  seoul: "Incheon", busan: "Gimhae", tokyo: "Haneda",
  ankara: "Esenboğa", helsinki: "Vantaa", amsterdam: "Schiphol",
  istanbul: "Airport", paris: "Le Bourget",
  "hong kong": "Observatory", "lau fau shan": "Lau Fau Shan",
  taipei: "Songshan", "new york": "LaGuardia",
  "los angeles": "LAX", chicago: "O'Hare", denver: "Buckley",
  atlanta: "Hartsfield", miami: "MIA", "san francisco": "SFO",
  houston: "Hobby", dallas: "Love Field", austin: "Bergstrom",
  seattle: "SeaTac",
};

export default function MonitorPanel() {
  const store = useDashboardStore();
  const details = store.cityDetailsByName;
  const [time, setTime] = useState("");
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const cancelledRef = useRef(false);
  const fetchingRef = useRef(false);

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [notify, setNotify] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("monitor_notify") !== "off";
  });

  const refreshAll = useCallback(
    async (force: boolean) => {
      if (fetchingRef.current) return;
      if (
        !force &&
        lastRefreshCompletedAt > 0 &&
        Date.now() - lastRefreshCompletedAt < MONITOR_FRESHNESS_TTL_MS
      ) {
        setInitialLoadDone(true);
        return;
      }
      fetchingRef.current = true;
      const tasks = MONITOR_KEYS.map((k) => () =>
        store.ensureCityDetail(k, force, "panel"),
      );
      await runConcurrent(tasks, MONITOR_FETCH_CONCURRENCY, () => cancelledRef.current);
      if (!cancelledRef.current) {
        lastRefreshCompletedAt = Date.now();
        setInitialLoadDone(true);
      }
      fetchingRef.current = false;
    },
    [store.ensureCityDetail],
  );

  useEffect(() => {
    cancelledRef.current = false;
    void refreshAll(false);
    const t = setInterval(() => {
      if (!document.hidden) void refreshAll(true);
    }, MONITOR_REFRESH_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(t);
    };
  }, [refreshAll]);

  const cities: MonitorCity[] = useMemo(
    () => MONITOR_KEYS.map((k) => ({ key: k, detail: details[k] })),
    [details],
  );

  const sorted = useMemo(
    () =>
      [...cities].sort((a, b) => {
        const ta = a.detail?.airport_current?.temp ?? a.detail?.current?.temp ?? null;
        const tb = b.detail?.airport_current?.temp ?? b.detail?.current?.temp ?? null;
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1;
        if (tb == null) return -1;
        return tb - ta;
      }),
    [cities],
  );

  const toggleNotify = () => {
    const next = !notify;
    setNotify(next);
    localStorage.setItem("monitor_notify", next ? "on" : "off");
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  useEffect(() => {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = new Date().toDateString();
    let notified: Record<string, unknown> = {};
    try { notified = JSON.parse(localStorage.getItem("monitor_notified_highs") || "{}"); } catch {}
    if (notified._day !== today) notified = { _day: today };

    for (const c of sorted) {
      const ac = c.detail?.airport_current;
      const cur = ac?.temp ?? c.detail?.current?.temp ?? null;
      const max = ac?.max_so_far ?? null;
      if (cur != null && max != null && cur >= max + 0.3) {
        const key = `${c.key}|${cur}`;
        if (!notified[key]) {
          notified[key] = true;
          localStorage.setItem("monitor_notified_highs", JSON.stringify(notified));
          const name = c.detail?.display_name || c.key;
          new Notification(`🔴 New High — ${name}`, {
            body: `${cur}°C · New daily high.`,
            tag: key,
            requireInteraction: true,
          });
        }
      }
    }
  }, [sorted, notify]);

  return (
    <div className="monitor-panel">
      <div className="monitor-header">
        <h2 className="monitor-title">🔥 市场监控</h2>
        <div className="monitor-controls">
          {!initialLoadDone && (
            <span className="monitor-loading-indicator">
              <span className="monitor-loading-dot" />
              加载中…
            </span>
          )}
          <button
            className={`monitor-notify-btn${notify ? "" : " muted"}`}
            onClick={toggleNotify}
            title={notify ? "关闭价格提醒" : "开启价格提醒"}
          >
            {notify ? "🔔" : "🔕"}
          </button>
          <span className="monitor-time">{time}</span>
        </div>
      </div>

      <div className="monitor-grid">
        {!initialLoadDone
          ? MONITOR_KEYS.map((k) => <SkeletonCard key={k} />)
          : sorted.map((c) => {
              const ac = c.detail?.airport_current;
              const cur = ac?.temp ?? c.detail?.current?.temp ?? null;
              const max = ac?.max_so_far ?? null;
              const mtt = ac?.max_temp_time ?? null;
              const obs = ac?.obs_time ?? c.detail?.local_time ?? "";
              const age = ac?.obs_age_min ?? null;
              const newHigh = cur != null && max != null && cur >= max + 0.3;
              const warm = !newHigh && cur != null && cur >= 30;
              const tr = trendClass(c.detail);
              const rwPairs = c.detail?.amos?.runway_obs?.runway_pairs ?? [];
              const rwTemps = c.detail?.amos?.runway_obs?.temperatures ?? [];

              return (
                <div
                  key={c.key}
                  className={`monitor-card${newHigh ? " new-high" : ""}`}
                >
                  <div className="monitor-card-head">
                    <span className="monitor-city-name">
                      {c.detail?.display_name || c.key}
                    </span>
                    <span className="monitor-airport-name">/ {AIRPORT_NAMES[c.key]}</span>
                    <span className="monitor-obs-time">{obs}</span>
                    {newHigh && (
                      <span className="monitor-new-high-badge">◆新高</span>
                    )}
                  </div>

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

                  <div className="monitor-stats">
                    <div className="monitor-high-row">
                      <span className="monitor-stat-label">High</span>
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
                      <span className="monitor-stat-label">Obs</span>
                      {age != null ? (
                        <span className="monitor-obs-age">{age} min ago</span>
                      ) : (
                        <span className="monitor-stat-missing">--</span>
                      )}
                    </div>
                  </div>

                  {rwPairs.length > 0 && rwTemps.length > 0 && (
                    <>
                      <div className="monitor-divider" />
                      {rwPairs.map((p, i) => {
                        const t = rwTemps[i]?.[0];
                        if (t == null) return null;
                        return (
                          <div key={i} className="monitor-rw-row">
                            <span className="monitor-rw-label">{p[0]}/{p[1]}</span>
                            <span className="monitor-rw-temp">{t.toFixed(1)}°C</span>
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
