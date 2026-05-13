"use client";

import { useMemo, useState, useEffect } from "react";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import type { CityDetail } from "@/lib/dashboard-types";

const MONITOR_KEYS = [
  "seoul", "busan", "tokyo", "ankara", "helsinki", "amsterdam",
  "istanbul", "paris", "hong kong", "lau fau shan", "taipei",
] as const;

type MonitorCity = {
  key: string;
  detail: CityDetail | undefined;
};

function fmt(v: number | null | undefined): string {
  return v != null ? v.toFixed(1) : "--";
}

function trendIcon(detail: CityDetail | undefined): { s: string; c: string } {
  if (!detail?.airport_current) return { s: "→", c: "flat" };
  const ac = detail.airport_current;
  const cur = ac.temp ?? detail.current?.temp ?? null;
  const max = ac.max_so_far ?? null;
  if (cur != null && max != null && cur >= max + 0.3) return { s: "↑", c: "rising" };
  if (cur != null && max != null && cur < max - 1.0) return { s: "↓", c: "falling" };
  return { s: "→", c: "flat" };
}

export default function MonitorPanel() {
  const store = useDashboardStore();
  const details = store.cityDetailsByName;
  const [time, setTime] = useState("");

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [notify, setNotify] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("monitor_notify") !== "off";
  });

  const cities: MonitorCity[] = useMemo(() => {
    return MONITOR_KEYS.map((k) => ({ key: k, detail: details[k] }));
  }, [details]);

  // Sort by temp descending
  const sorted = useMemo(() => {
    return [...cities].sort((a, b) => {
      const ta = a.detail?.airport_current?.temp ?? a.detail?.current?.temp ?? null;
      const tb = b.detail?.airport_current?.temp ?? b.detail?.current?.temp ?? null;
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return tb - ta;
    });
  }, [cities]);

  const toggleNotify = () => {
    const next = !notify;
    setNotify(next);
    localStorage.setItem("monitor_notify", next ? "on" : "off");
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  // Check for new highs and fire notifications
  useEffect(() => {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const c of sorted) {
      const ac = c.detail?.airport_current;
      const cur = ac?.temp ?? c.detail?.current?.temp ?? null;
      const max = ac?.max_so_far ?? null;
      if (cur != null && max != null && cur >= max + 0.3) {
        const key = `${c.key}|${cur}`;
        const today = new Date().toDateString();
        let notified: Record<string, unknown> = {};
        try {
          notified = JSON.parse(localStorage.getItem("monitor_notified_highs") || "{}");
        } catch {}
        if (notified._day !== today) notified = { _day: today };
        if (!notified[key]) {
          notified[key] = true;
          localStorage.setItem("monitor_notified_highs", JSON.stringify(notified));
          const name = c.detail?.display_name || c.key;
          new Notification(`🔴 New High — ${name}`, {
            body: `${cur}°C\nNew daily high.`,
            tag: key,
            requireInteraction: true,
          });
        }
      }
    }
  }, [sorted, notify]);

  const airportName = (key: string): string => {
    const m: Record<string, string> = {
      seoul: "Incheon", busan: "Gimhae", tokyo: "Haneda",
      ankara: "Esenboğa", helsinki: "Vantaa", amsterdam: "Schiphol",
      istanbul: "Airport", paris: "Le Bourget",
      "hong kong": "Observatory", "lau fau shan": "Lau Fau Shan",
      taipei: "Songshan",
    };
    return m[key] || "";
  };

  return (
    <div style={{ background: "#0f1117", height: "100%", overflow: "auto", padding: "20px 24px" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid #1e2130",
      }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#e8eaed" }}>🔥 市场监控</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={toggleNotify}
            style={{
              background: "none", border: "1px solid #2a2e40", borderRadius: 6,
              padding: "2px 8px", fontSize: 16, cursor: "pointer", opacity: notify ? 1 : 0.4,
            }}
          >
            {notify ? "🔔" : "🔕"}
          </button>
          <span style={{ fontSize: 13, color: "#5a6170" }}>{time}</span>
        </div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
        gap: 14,
      }}>
        {sorted.map((c) => {
          const ac = c.detail?.airport_current;
          const cur = ac?.temp ?? c.detail?.current?.temp ?? null;
          const max = ac?.max_so_far ?? null;
          const mtt = ac?.max_temp_time ?? null;
          const obs = ac?.obs_time ?? c.detail?.local_time ?? "";
          const age = ac?.obs_age_min ?? null;
          const newHigh = cur != null && max != null && cur >= max + 0.3;
          const warm = cur != null && cur >= 30;
          const tr = trendIcon(c.detail);
          const rw = c.detail?.amos?.runway_obs;
          const rwPairs = rw?.runway_pairs || [];
          const rwTemps = rw?.temperatures || [];

          return (
            <div key={c.key} style={{
              background: "#161822", border: `1px solid ${newHigh ? "rgba(124,58,237,0.3)" : "#1e2130"}`,
              borderRadius: 12, padding: "20px 24px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 15, flexWrap: "wrap" }}>
                <span style={{ color: "#e0e3e8", fontWeight: 700 }}>{c.detail?.display_name || c.key}</span>
                <span style={{ color: "#6a7180" }}>/ {airportName(c.key)}</span>
                <span style={{ marginLeft: "auto", color: "#4a5160", fontSize: 14 }}>{obs}</span>
                {newHigh && (
                  <span style={{ fontSize: 12, padding: "1px 6px", borderRadius: 4,
                    background: "rgba(124,58,237,.18)", color: "#a78bfa", fontWeight: 600 }}>
                    ◆新高
                  </span>
                )}
              </div>

              <div style={{ margin: "8px 0 10px", lineHeight: 1.15 }}>
                {cur != null ? (
                  <>
                    <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-.03em",
                      color: newHigh ? "#c084fc" : warm ? "#f59e0b" : "#e8eaed" }}>
                      {cur.toFixed(1)}
                    </span>
                    <span style={{ fontSize: 20, color: "#5a6170", marginLeft: 3 }}>°C</span>
                  </>
                ) : (
                  <span style={{ fontSize: 30, color: "#3a4050" }}>--</span>
                )}
              </div>

              <div style={{ fontSize: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ color: "#4a5160" }}>High</span>
                  {max != null ? (
                    <>
                      <span style={{ color: "#9aa0b0" }}>{max.toFixed(1)}°C</span>
                      {mtt && <span style={{ fontSize: 12, color: "#4a5160", marginLeft: 2 }}>{mtt}</span>}
                    </>
                  ) : (
                    <span style={{ color: "#3a4050" }}>--</span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 700,
                    color: tr.c === "rising" ? "#34d399" : tr.c === "falling" ? "#60a5fa" : "#5a6170" }}>
                    {tr.s}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <span style={{ color: "#4a5160" }}>Obs</span>
                  {age != null ? (
                    <span style={{ color: "#5a6170", fontSize: 13 }}>{age} min ago</span>
                  ) : (
                    <span style={{ color: "#3a4050" }}>--</span>
                  )}
                </div>
              </div>

              {rwPairs.length > 0 && rwTemps.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ height: 1, background: "#1e2130", marginBottom: 8 }} />
                  {rwPairs.map((p, i) => {
                    const t = rwTemps[i]?.[0];
                    if (t == null) return null;
                    return (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
                        <span style={{ color: "#4a5160" }}>{p[0]}/{p[1]}</span>
                        <span style={{ color: "#7a8290" }}>{t.toFixed(1)}°C</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
