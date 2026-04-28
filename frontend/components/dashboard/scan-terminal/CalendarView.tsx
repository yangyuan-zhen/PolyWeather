import { memo, useEffect, useMemo, useState } from "react";
import { getWindowPhaseMeta } from "@/components/dashboard/opportunity-window-phase";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import { formatTemperatureValue } from "@/lib/temperature-utils";
import {
  buildCalendarCoreReason,
  buildCalendarMeta,
  dedupeCalendarRows,
  formatCalendarCardShortDate,
  getCalendarActionGroup,
  isCalendarActionable,
  type CalendarActionItem,
} from "@/components/dashboard/scan-terminal/calendar-action-utils";

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

  return (
    <button
      type="button"
      className={`scan-calendar-card peak-${meta.tone} ${selected ? "selected" : ""}`}
      onClick={() => onSelectRow(row)}
    >
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
      <p className="scan-calendar-reason">{reason}</p>
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
          {formatCalendarCardShortDate(row, locale)} · {row.local_time || "--"}
        </span>
        <span>{phaseMeta.label}</span>
      </div>
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
    }, 60_000);
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
                {group.subtitle}
              </div>
            </div>
            <div className="scan-calendar-count">
              {locale === "en-US" ? `${group.items.length} rows` : `${group.items.length} 条`}
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
  );
});

