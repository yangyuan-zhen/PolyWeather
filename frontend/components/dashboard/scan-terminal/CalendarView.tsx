import { memo, useEffect, useMemo, useState } from "react";
import { getWindowPhaseMeta } from "@/components/dashboard/opportunity-window-phase";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import { formatTemperatureValue } from "@/lib/temperature-utils";
import {
  buildCalendarCoreReason,
  buildCalendarMeta,
  dedupeCalendarRows,
  getCalendarActionGroup,
  isCalendarActionable,
  type CalendarActionItem,
} from "@/components/dashboard/scan-terminal/calendar-action-utils";

function formatUserClock(now: Date) {
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatUserFullDate(now: Date, locale: string) {
  return now.toLocaleDateString(locale === "en-US" ? "en-US" : "zh-CN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const CalendarActionCard = memo(function CalendarActionCard({
  item,
  locale,
  selected,
  onSelectRow,
}: {
  item: CalendarActionItem;
  locale: string;
  selected: boolean;
  onSelectRow: (row: ScanOpportunityRow) => void;
}) {
  const { row, meta, reason } = item;
  const tempSymbol = row.temp_symbol || "°C";
  const phaseMeta = getWindowPhaseMeta(row, locale);
  const isEn = locale === "en-US";

  return (
    <button
      type="button"
      className={`scan-calendar-card peak-${meta.tone} ${selected ? "selected" : ""}`}
      onClick={() => onSelectRow(row)}
    >
      <div className="scan-calendar-card-top">
        <div className="scan-calendar-city">
          {getLocalizedCityName(
            row.city,
            row.city_display_name || row.display_name || row.city,
            locale,
          )}
        </div>
        <span className={`scan-calendar-badge tone-${meta.tone}`}>
          {meta.tone === "active"
            ? isEn ? "NOW" : "进行中"
            : meta.tone === "upcoming"
              ? isEn ? "SOON" : "即将"
              : meta.tone === "later"
                ? isEn ? "LATER" : "稍后"
                : isEn ? "PAST" : "已过"}
        </span>
      </div>

      <div className="scan-calendar-user-time">
        <span className="scan-calendar-user-label">
          {isEn ? "Your time" : "本地时间"}
        </span>
        <strong>{meta.localWindowLabel || meta.detail}</strong>
      </div>

      <div className="scan-calendar-countdown">
        <span className={`scan-calendar-countdown-timer tone-${meta.tone}`}>
          {meta.title}
        </span>
      </div>

      <p className="scan-calendar-reason">{reason}</p>

      <div className="scan-calendar-card-foot">
        <div className="scan-calendar-deb">
          <span>{isEn ? "DEB high" : "DEB 预测高点"}</span>
          <b>
            {row.deb_prediction != null
              ? formatTemperatureValue(row.deb_prediction, tempSymbol)
              : "--"}
          </b>
        </div>
        <div className="scan-calendar-phase">
          <span>{phaseMeta.label}</span>
        </div>
      </div>

      {meta.cityWindowLabel && meta.cityWindowLabel !== meta.detail ? (
        <div className="scan-calendar-city-time">
          {isEn ? "City window: " : "城市窗口："}
          {meta.cityWindowLabel}
        </div>
      ) : null}
    </button>
  );
});

export const CalendarView = memo(function CalendarView({
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
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const groups = useMemo(() => {
    const byPhase = new Map<
      string,
      {
        label: string;
        subtitle: string;
        sort: number;
        items: CalendarActionItem[];
      }
    >();
    dedupeCalendarRows(rows).forEach((row) => {
      const meta = buildCalendarMeta(row, locale, snapshotMs, nowMs);
      if (!isCalendarActionable(row, meta, nowMs)) return;
      const actionGroup = getCalendarActionGroup(row, meta, nowMs, locale);
      const current = byPhase.get(actionGroup.key) || {
        label: actionGroup.label,
        subtitle: actionGroup.subtitle,
        sort: actionGroup.sort,
        items: [],
      };
      current.items.push({
        row,
        meta,
        reason: buildCalendarCoreReason(row, actionGroup, locale),
      });
      byPhase.set(actionGroup.key, current);
    });
    return Array.from(byPhase.entries())
      .sort(([, left], [, right]) => left.sort - right.sort)
      .map(([key, group]) => ({
        key,
        label: group.label,
        subtitle: group.subtitle,
        items: group.items.sort((left, right) => {
          if (left.meta.sort !== right.meta.sort) return left.meta.sort - right.meta.sort;
          return Number(right.row.edge_percent || 0) - Number(left.row.edge_percent || 0);
        }),
      }));
  }, [locale, nowMs, rows, snapshotMs]);

  const now = new Date(nowMs);
  const isEn = locale === "en-US";

  if (!groups.length) {
    return (
      <div className="scan-calendar-empty">
        <div className="scan-calendar-empty-title">
          {isEn
            ? "No actionable windows in the next 12 hours"
            : "未来 12 小时内没有可行动日历窗口"}
        </div>
        <div className="scan-calendar-empty-sub">
          {isEn
            ? "Check back after the next observation cycle"
            : "等待下一轮观测后再查看"}
        </div>
      </div>
    );
  }

  return (
    <div className="scan-calendar-view">
      <div className="scan-calendar-header">
        <div className="scan-calendar-clock">
          <span className="scan-calendar-clock-time">
            {formatUserClock(now)}
          </span>
          <span className="scan-calendar-clock-date">
            {formatUserFullDate(now, locale)}
          </span>
        </div>
        <div className="scan-calendar-clock-meta">
          {isEn ? "Your local time · Auto-refreshes" : "您所在时区 · 自动刷新"}
        </div>
      </div>

      <div className="scan-calendar-groups">
        {groups.map((group) => (
          <section key={group.key} className="scan-calendar-group">
            <div className="scan-calendar-group-head">
              <div>
                <div className="scan-calendar-group-label">{group.label}</div>
                <div className="scan-calendar-group-sub">{group.subtitle}</div>
              </div>
              <div className="scan-calendar-group-count">
                {group.items.length}
              </div>
            </div>
            <div className="scan-calendar-grid">
              {group.items.map((item) => (
                <CalendarActionCard
                  key={item.row.id}
                  item={item}
                  locale={locale}
                  selected={selectedRowId === item.row.id}
                  onSelectRow={onSelectRow}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
});
