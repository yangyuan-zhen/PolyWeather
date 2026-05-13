"use client";

import { useEffect, useState, useCallback } from "react";

interface RunwayPair {
  label: string;
  temp: number;
}

interface CitySnapshot {
  en_name: string;
  airport: string;
  obs_time: string;
  current_temp: number | null;
  max_so_far: number | null;
  max_temp_time: string | null;
  trend_sym: string;
  trend_css: string;
  obs_age_min: number | null;
  new_high: boolean;
  temp_warm: boolean;
  runway_pairs?: string; // HTML from backend
}

function parseRunway(html: string): RunwayPair[] {
  const pairs: RunwayPair[] = [];
  const re = /runway-label">([^<]+)<.*?runway-temp">([\d.]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    pairs.push({ label: m[1], temp: parseFloat(m[2]) });
  }
  return pairs;
}

export default function MonitorPanel() {
  const [cities, setCities] = useState<CitySnapshot[]>([]);
  const [time, setTime] = useState("");
  const [notify, setNotify] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("monitor_notify") !== "off"
  );

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/m");
      const data = await res.json();
      setCities(data);
      setTime(new Date().toLocaleTimeString());
    } catch {}
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  const toggleNotify = () => {
    const next = !notify;
    setNotify(next);
    localStorage.setItem("monitor_notify", next ? "on" : "off");
    if (next && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  return (
    <div style={{ background: "#0f1117", height: "100%", overflow: "auto", padding: "20px 24px" }}>
      {/* Header */}
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
            title="新高提醒开关"
          >
            {notify ? "🔔" : "🔕"}
          </button>
          <span style={{ fontSize: 13, color: "#5a6170" }}>{time}</span>
        </div>
      </div>

      {/* Card Grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
        gap: 14,
      }}>
        {cities.map((c) => {
          const cn = c.new_high ? " new-high-card" : "";
          const wc = c.temp_warm ? " warm" : "";
          const nv = c.new_high ? " new-high-val" : "";
          const rw = c.runway_pairs ? parseRunway(c.runway_pairs) : [];

          return (
            <div key={c.en_name} className={`card${cn}`} style={cardStyle}>
              {/* Top */}
              <div style={cardTopStyle}>
                <span style={{ color: "#e0e3e8", fontWeight: 700 }}>{c.en_name}</span>
                <span style={{ color: "#6a7180" }}>/ {c.airport}</span>
                <span style={{ marginLeft: "auto", color: "#4a5160", fontSize: 14 }}>{c.obs_time}</span>
                {c.new_high && (
                  <span style={{ fontSize: 12, padding: "1px 6px", borderRadius: 4,
                    background: "rgba(124,58,237,.18)", color: "#a78bfa", fontWeight: 600 }}>
                    ◆新高
                  </span>
                )}
              </div>

              {/* Temp */}
              <div style={{ margin: "8px 0 10px", lineHeight: 1.15 }}>
                {c.current_temp != null ? (
                  <>
                    <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-.03em",
                      color: c.new_high ? "#c084fc" : c.temp_warm ? "#f59e0b" : "#e8eaed" }}>
                      {c.current_temp.toFixed(1)}
                    </span>
                    <span style={{ fontSize: 20, color: "#5a6170", marginLeft: 3 }}>°C</span>
                  </>
                ) : (
                  <span style={{ fontSize: 30, color: "#3a4050" }}>--</span>
                )}
              </div>

              {/* Meta */}
              <div style={{ fontSize: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ color: "#4a5160" }}>High</span>
                  {c.max_so_far != null ? (
                    <>
                      <span style={{ color: "#9aa0b0" }}>{c.max_so_far.toFixed(1)}°C</span>
                      {c.max_temp_time && (
                        <span style={{ fontSize: 12, color: "#4a5160", marginLeft: 2 }}>{c.max_temp_time}</span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "#3a4050" }}>--</span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 700,
                    color: c.trend_css === "rising" ? "#34d399" :
                           c.trend_css === "falling" ? "#60a5fa" : "#5a6170" }}>
                    {c.trend_sym}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <span style={{ color: "#4a5160" }}>Obs</span>
                  {c.obs_age_min != null ? (
                    <span style={{ color: "#5a6170", fontSize: 13 }}>{c.obs_age_min} min ago</span>
                  ) : (
                    <span style={{ color: "#3a4050" }}>--</span>
                  )}
                </div>
              </div>

              {/* Runway */}
              {rw.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ height: 1, background: "#1e2130", marginBottom: 8 }} />
                  {rw.map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
                      <span style={{ color: "#4a5160" }}>{r.label}</span>
                      <span style={{ color: "#7a8290" }}>{r.temp.toFixed(1)}°C</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#161822", border: "1px solid #1e2130", borderRadius: 12,
  padding: "20px 24px", position: "relative",
};

const cardTopStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  marginBottom: 14, fontSize: 15, flexWrap: "wrap",
};
