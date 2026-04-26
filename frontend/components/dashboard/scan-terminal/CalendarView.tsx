import { useMemo } from "react";
import { getWindowPhaseMeta } from "@/components/dashboard/OpportunityTable";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import { formatTemperatureValue } from "@/lib/dashboard-utils";
import { formatShortDate, getPeakCountdownMeta } from "@/components/dashboard/scan-terminal/decision-utils";

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
  const groups = useMemo(() => {
    const order = ["active", "next", "today", "later", "past"];
    const byPhase = new Map<
      string,
      {
        label: string;
        sort: number;
        items: Array<{ row: ScanOpportunityRow; meta: ReturnType<typeof getPeakCountdownMeta> }>;
      }
    >();
    dedupeCalendarRows(rows).forEach((row) => {
      const meta = getPeakCountdownMeta(row, locale);
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
  }, [locale, rows]);

  if (!groups.length) {
    return (
      <div className="scan-empty-state compact">
        <div className="scan-empty-title">
          {locale === "en-US" ? "No dated opportunities" : "当前没有日期机会"}
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
                  <small>{meta.detail}</small>
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

