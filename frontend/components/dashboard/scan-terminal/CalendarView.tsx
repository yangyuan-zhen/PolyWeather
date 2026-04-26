import { useEffect, useMemo, useState } from "react";
import { getWindowPhaseMeta } from "@/components/dashboard/OpportunityTable";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import { formatTemperatureValue } from "@/lib/dashboard-utils";
import { formatShortDate, getPeakCountdownMeta } from "@/components/dashboard/scan-terminal/decision-utils";

const CALENDAR_UPCOMING_HORIZON_MINUTES = 12 * 60;
const CALENDAR_POST_PEAK_GRACE_MINUTES = 3 * 60;
const MINUTE_MS = 60_000;

type CalendarMeta = ReturnType<typeof getPeakCountdownMeta> & {
  localWindowLabel?: string | null;
  cityWindowLabel?: string | null;
  startAtMs?: number | null;
  endAtMs?: number | null;
};

function normalizeCalendarCityKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function getCalendarCardKey(row: ScanOpportunityRow) {
  const city =
    normalizeCalendarCityKey(row.city) ||
    normalizeCalendarCityKey(row.city_display_name) ||
    normalizeCalendarCityKey(row.display_name);
  const date = String(row.selected_date || row.local_date || "").trim();
  return `${city || row.id}:${date || "date-unknown"}`;
}

function getCalendarRowScore(row: ScanOpportunityRow) {
  return Number(row.final_score || 0) * 1000 + Number(row.edge_percent || 0);
}

function dedupeCalendarRows(rows: ScanOpportunityRow[]) {
  const bestByCard = new Map<string, ScanOpportunityRow>();
  rows.forEach((row) => {
    const key = getCalendarCardKey(row);
    const current = bestByCard.get(key);
    if (!current || getCalendarRowScore(row) > getCalendarRowScore(current)) {
      bestByCard.set(key, row);
    }
  });
  return [...bestByCard.values()];
}

function finiteCalendarNumber(value?: number | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatUserLocalDate(value: Date, locale: string) {
  return value.toLocaleDateString(locale === "en-US" ? "en-US" : "zh-CN", {
    month: "short",
    day: "numeric",
  });
}

function formatUserLocalTime(value: Date, locale: string) {
  return value.toLocaleTimeString(locale === "en-US" ? "en-US" : "zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUserLocalWindow(
  startAtMs: number,
  endAtMs: number,
  locale: string,
) {
  const start = new Date(startAtMs);
  const end = new Date(endAtMs);
  const startDate = formatUserLocalDate(start, locale);
  const endDate = formatUserLocalDate(end, locale);
  const startTime = formatUserLocalTime(start, locale);
  const endTime = formatUserLocalTime(end, locale);
  if (start.toDateString() === end.toDateString()) {
    return `${startDate} ${startTime}-${endTime}`;
  }
  return `${startDate} ${startTime} → ${endDate} ${endTime}`;
}

function buildCalendarMeta(
  row: ScanOpportunityRow,
  locale: string,
  snapshotMs: number,
  nowMs: number,
): CalendarMeta {
  const startDelta = finiteCalendarNumber(row.minutes_until_peak_start);
  const endDelta = finiteCalendarNumber(row.minutes_until_peak_end);
  if (startDelta === null || endDelta === null) {
    const fallback = getPeakCountdownMeta(row, locale);
    return {
      ...fallback,
      cityWindowLabel: fallback.detail,
      localWindowLabel: null,
      startAtMs: null,
      endAtMs: null,
    };
  }

  const startAtMs = snapshotMs + startDelta * MINUTE_MS;
  const endAtMs = snapshotMs + endDelta * MINUTE_MS;
  const liveStartDelta = (startAtMs - nowMs) / MINUTE_MS;
  const liveEndDelta = (endAtMs - nowMs) / MINUTE_MS;
  const meta = getPeakCountdownMeta(
    {
      ...row,
      window_phase: null,
      minutes_until_peak_start: liveStartDelta,
      minutes_until_peak_end: liveEndDelta,
    },
    locale,
  );

  return {
    ...meta,
    cityWindowLabel: meta.detail,
    localWindowLabel: formatUserLocalWindow(startAtMs, endAtMs, locale),
    startAtMs,
    endAtMs,
  };
}

function isCalendarActionable(row: ScanOpportunityRow, meta: CalendarMeta, nowMs: number) {
  if (meta.startAtMs !== null && meta.startAtMs !== undefined) {
    const endAtMs = meta.endAtMs ?? meta.startAtMs;
    return (
      meta.startAtMs <= nowMs + CALENDAR_UPCOMING_HORIZON_MINUTES * MINUTE_MS &&
      endAtMs >= nowMs - CALENDAR_POST_PEAK_GRACE_MINUTES * MINUTE_MS
    );
  }

  const phase = String(row.window_phase || "").toLowerCase();
  const startDelta = finiteCalendarNumber(row.minutes_until_peak_start);
  const endDelta = finiteCalendarNumber(row.minutes_until_peak_end);

  if (phase === "active_peak" || (startDelta !== null && startDelta <= 0 && endDelta !== null && endDelta >= 0)) {
    return true;
  }

  if (phase === "post_peak") {
    return endDelta === null || endDelta >= -CALENDAR_POST_PEAK_GRACE_MINUTES;
  }

  if (startDelta === null) {
    return phase === "setup_today";
  }

  return startDelta >= 0 && startDelta <= CALENDAR_UPCOMING_HORIZON_MINUTES;
}

export function CalendarView({
  rows,
  locale,
  selectedRowId,
  onSelectRow,
}: {
  rows: ScanOpportunityRow[];
  locale: string;
  selectedRowId: string | null;
  onSelectRow: (row: ScanOpportunityRow) => void;
}) {
  const [snapshotMs, setSnapshotMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setSnapshotMs(Date.now());
    setNowMs(Date.now());
  }, [rows]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const groups = useMemo(() => {
    const order = ["active", "next", "today", "later", "past"];
    const byPhase = new Map<
      string,
      {
        label: string;
        sort: number;
        items: Array<{ row: ScanOpportunityRow; meta: CalendarMeta }>;
      }
    >();
    dedupeCalendarRows(rows).forEach((row) => {
      const meta = buildCalendarMeta(row, locale, snapshotMs, nowMs);
      if (!isCalendarActionable(row, meta, nowMs)) return;
      const current = byPhase.get(meta.key) || {
        label: meta.groupLabel,
        sort: order.indexOf(meta.key) >= 0 ? order.indexOf(meta.key) : order.length,
        items: [],
      };
      current.items.push({ row, meta });
      byPhase.set(meta.key, current);
    });
    return Array.from(byPhase.entries())
      .sort(([, left], [, right]) => left.sort - right.sort)
      .map(([key, group]) => ({
        key,
        label: group.label,
        items: group.items.sort((left, right) => {
          if (left.meta.sort !== right.meta.sort) return left.meta.sort - right.meta.sort;
          return Number(right.row.edge_percent || 0) - Number(left.row.edge_percent || 0);
        }),
      }));
  }, [locale, nowMs, rows, snapshotMs]);

  if (!groups.length) {
    return (
      <div className="scan-empty-state compact">
        <div className="scan-empty-title">
          {locale === "en-US"
            ? "No actionable calendar windows in the next 12 hours"
            : "未来 12 小时内没有可行动日历窗口"}
        </div>
      </div>
    );
  }

  return (
    <div className="scan-calendar-view">
      {groups.map((group) => (
        <section key={group.key} className="scan-calendar-group">
          <div className="scan-calendar-group-head">
            <div>
              <div className="scan-calendar-date">{group.label}</div>
              <div className="scan-calendar-subtitle">
                {locale === "en-US"
                  ? "Ordered by DEB peak-window countdown"
                  : "按 DEB 峰值窗口倒计时排序"}
              </div>
            </div>
            <div className="scan-calendar-count">
              {locale === "en-US" ? `${group.items.length} rows` : `${group.items.length} 条`}
            </div>
          </div>
          <div className="scan-calendar-grid">
            {group.items.map(({ row, meta }) => (
              <button
                key={row.id}
                type="button"
                className={`scan-calendar-card peak-${meta.tone} ${selectedRowId === row.id ? "selected" : ""}`}
                onClick={() => onSelectRow(row)}
              >
                {(() => {
                  const tempSymbol = row.temp_symbol || "°C";
                  const phaseMeta = getWindowPhaseMeta(row, locale);
                  return (
                    <>
                <div className="scan-calendar-city">
                  {getLocalizedCityName(
                    row.city,
                    row.city_display_name || row.display_name || row.city,
                    locale,
                  )}
                </div>
                <div className="scan-calendar-countdown">
                  {meta.title}
                  {meta.localWindowLabel ? (
                    <small>
                      {locale === "en-US" ? "Your time: " : "本地时间："}
                      {meta.localWindowLabel}
                    </small>
                  ) : null}
                  <small>
                    {locale === "en-US" ? "City window: " : "城市窗口："}
                    {meta.cityWindowLabel || meta.detail}
                  </small>
                </div>
                <div className="scan-calendar-action">
                  <span>{locale === "en-US" ? "DEB high" : "DEB 预测高点"}</span>
                  <b>
                    {row.deb_prediction != null
                      ? formatTemperatureValue(row.deb_prediction, tempSymbol)
                      : "--"}
                  </b>
                </div>
                <div className="scan-calendar-meta">
                  <span>
                    {formatShortDate(row.selected_date || row.local_date, locale)} · {row.local_time || "--"}
                  </span>
                  <span>{phaseMeta.label}</span>
                </div>
                    </>
                  );
                })()}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

