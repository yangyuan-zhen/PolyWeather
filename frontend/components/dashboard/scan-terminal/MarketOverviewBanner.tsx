"use client";

import clsx from "clsx";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBackendApi, buildBrowserBackendHeaders } from "@/lib/backend-api";
import styles from "./MarketOverviewBanner.module.css";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";

interface OverviewPayload {
  overview_zh: string;
  overview_en: string;
  highlights: Array<{ city: string; note_zh: string; note_en: string }>;
  generated_at: string | null;
}

export function MarketOverviewBanner({
  isEn,
  isPro,
  rows,
}: {
  isEn: boolean;
  isPro: boolean;
  rows: ScanOpportunityRow[];
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);

  const fetchOverview = useCallback(async () => {
    if (!isPro || !rows.length || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(false);
    try {
      const headers = await buildBrowserBackendHeaders({
        "Content-Type": "application/json",
      });
      const resp = await fetchBackendApi("/api/scan/terminal/overview", {
        method: "POST",
        headers,
        body: JSON.stringify({
          rows: rows.slice(0, 40).map((row) => ({
            city: row.city ?? row.display_name ?? "",
            display_name: row.display_name ?? row.city ?? "",
            local_date: row.local_date ?? "",
            deb_prediction: row.deb_prediction ?? null,
            current_temp: row.current_temp ?? null,
            current_max_so_far: row.current_max_so_far ?? null,
            risk_level: row.risk_level ?? "",
            temp_symbol: row.temp_symbol ?? "°C",
          })),
        }),
      });
      if (resp.ok) {
        const json = await resp.json();
        setData(json);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [isPro, rows]);

  useEffect(() => {
    if (isPro && rows.length > 0 && !fetchedRef.current) {
      fetchOverview();
    }
  }, [isPro, rows.length, fetchOverview]);

  if (!isPro || rows.length === 0) return null;
  if (loading && !data) {
    return (
      <div className={clsx(styles.root, styles.loading)}>
        <Sparkles size={14} className={styles.icon} />
        <span>{isEn ? "AI is generating market overview…" : "AI 正在生成市场概览…"}</span>
      </div>
    );
  }
  if (error && !data) return null;

  const overviewText = data ? (isEn ? data.overview_en : data.overview_zh) : "";
  const highlights = data?.highlights ?? [];

  return (
    <div className={clsx(styles.root, collapsed && styles.collapsed)}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setCollapsed((c) => !c)}
        aria-label={isEn ? "Toggle market overview" : "切换市场概览"}
      >
        <span className={styles.preview}>
          {collapsed && overviewText ? overviewText.slice(0, isEn ? 120 : 60) + "…" : ""}
        </span>
        <span className={styles.toggle}>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </span>
      </button>

      {!collapsed && (
        <div className={styles.body}>
          <p className={styles.summary}>{overviewText}</p>
          {highlights.length > 0 && (
            <ul className={styles.highlights}>
              {highlights.map((h) => (
                <li key={h.city} className={styles.highlightItem}>
                  <strong>{h.city}</strong>
                  <span>{isEn ? h.note_en : h.note_zh}</span>
                </li>
              ))}
            </ul>
          )}
          {data?.generated_at && (
            <time className={styles.time} dateTime={data.generated_at}>
              {isEn ? "Generated " : "生成于 "}
              {new Date(data.generated_at).toLocaleTimeString(isEn ? "en-US" : "zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          )}
        </div>
      )}
    </div>
  );
}
