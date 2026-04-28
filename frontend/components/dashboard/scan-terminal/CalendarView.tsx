import { memo, useEffect, useMemo, useState } from "react";
import { getWindowPhaseMeta } from "@/components/dashboard/OpportunityTable";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { getLocalizedCityName } from "@/lib/dashboard-home-copy";
import { formatTemperatureValue } from "@/lib/dashboard-utils";
import {
  formatShortDate,
  getPeakCountdownMeta,
} from "@/components/dashboard/scan-terminal/decision-utils";

const CALENDAR_UPCOMING_HORIZON_MINUTES = 12 * 60;
const CALENDAR_POST_PEAK_GRACE_MINUTES = 3 * 60;
const MINUTE_MS = 60_000;

type CalendarMeta = ReturnType<typeof getPeakCountdownMeta> & {
  localWindowLabel?: string | null;
  cityWindowLabel?: string | null;
  startAtMs?: number | null;
  endAtMs?: number | null;
};

type CalendarActionGroup = {
  key: "now" | "next" | "later" | "past";
  label: string;
  subtitle: string;
  sort: number;
};

type CalendarActionItem = {
  row: ScanOpportunityRow;
  meta: CalendarMeta;
  reason: string;
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

function getCalendarActionGroup(
  row: ScanOpportunityRow,
  meta: CalendarMeta,
  nowMs: number,
  locale: string,
): CalendarActionGroup {
  const isEn = locale === "en-US";
  const phase = String(row.window_phase || "").toLowerCase();
  const startDelta =
    meta.startAtMs != null ? (meta.startAtMs - nowMs) / MINUTE_MS : finiteCalendarNumber(row.minutes_until_peak_start);
  const endDelta =
    meta.endAtMs != null ? (meta.endAtMs - nowMs) / MINUTE_MS : finiteCalendarNumber(row.minutes_until_peak_end);
  const isPast =
    phase === "post_peak" ||
    (endDelta != null && endDelta < 0) ||
    meta.key === "past";
  if (isPast) {
    return {
      key: "past",
      label: isEn ? "Past peak · confirm" : "已过峰值，等待确认",
      subtitle: isEn ? "Check whether a new high printed; avoid chasing if it did not." : "确认是否刷新高点；若无新高，避免追高。",
      sort: 3,
    };
  }
  const isNow =
    phase === "active_peak" ||
    (startDelta != null && startDelta <= 60) ||
    meta.key === "active";
  if (isNow) {
    return {
      key: "now",
      label: isEn ? "Watch now" : "现在可看",
      subtitle: isEn ? "Peak window is live or close enough to require immediate checks." : "峰值窗口正在进行或即将开始，需要马上核对。",
      sort: 0,
    };
  }
  if (startDelta != null && startDelta <= 180) {
    return {
      key: "next",
      label: isEn ? "In 1-3 hours" : "1-3 小时内",
      subtitle: isEn ? "Prepare the setup and wait for the next observation." : "提前准备，只等下一轮观测确认。",
      sort: 1,
    };
  }
  return {
    key: "later",
    label: isEn ? "Later today" : "今天稍后",
    subtitle: isEn ? "Keep on the board, but do not spend attention yet." : "先放在行动面板，不需要立刻盯盘。",
    sort: 2,
  };
}

function getCalendarModelUpper(row: ScanOpportunityRow) {
  const values = [
    finiteCalendarNumber(row.cluster_core_high),
    ...Object.values(row.model_cluster_sources || {}).map((value) => finiteCalendarNumber(value)),
  ].filter((value): value is number => value != null);
  return values.length ? Math.max(...values) : null;
}

function getCalendarModelLower(row: ScanOpportunityRow) {
  const values = [
    finiteCalendarNumber(row.cluster_core_low),
    ...Object.values(row.model_cluster_sources || {}).map((value) => finiteCalendarNumber(value)),
  ].filter((value): value is number => value != null);
  return values.length ? Math.min(...values) : null;
}

function firstSentence(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^.*?[。.!?？](?:\s|$)/);
  return (match?.[0] || text).trim();
}

function buildCalendarCoreReason(
  row: ScanOpportunityRow,
  group: CalendarActionGroup,
  locale: string,
) {
  const isEn = locale === "en-US";
  const tempSymbol = row.temp_symbol || "°C";
  const currentTemp = finiteCalendarNumber(row.current_temp ?? row.metar_context?.last_temp);
  const modelUpper = getCalendarModelUpper(row);
  const modelLower = getCalendarModelLower(row);
  const modelSpread =
    modelUpper != null && modelLower != null ? modelUpper - modelLower : null;
  if (currentTemp != null && modelUpper != null && currentTemp > modelUpper + 0.2) {
    return isEn
      ? `Observed ${formatTemperatureValue(currentTemp, tempSymbol)} is above the model upper bound; watch whether the high keeps revising up.`
      : `实测已高于模型上沿，需关注是否继续上修`;
  }
  if (group.key === "past") {
    return isEn
      ? "Peak window has passed; avoid chasing if no new high prints."
      : "峰值窗口已过，若无新高应避免追高";
  }
  if (row.metar_status?.stale_for_today || row.metar_context?.stale_for_today) {
    return isEn
      ? "METAR is stale, so use it as background only."
      : "METAR 已过旧，仅作背景参考";
  }
  if (currentTemp != null && modelLower != null && currentTemp < modelLower - 0.5) {
    return isEn
      ? "Observed temperature is still below the model core; wait for the next report."
      : "实测仍低于模型核心区，等待下一报文确认";
  }
  if (Number(row.cluster_model_count || 0) >= 4 && modelSpread != null && modelSpread <= 2) {
    return isEn
      ? "Models are tightly aligned; the next observation should decide direction."
      : "模型高度一致，等待下一报文确认方向";
  }
  const aiReason = firstSentence(
    isEn
      ? row.ai_watchlist_reason_en || row.ai_forecast_match_reason_en || row.ai_reason_en || row.ai_city_thesis_en
      : row.ai_watchlist_reason_zh || row.ai_forecast_match_reason_zh || row.ai_reason_zh || row.ai_city_thesis_zh,
  );
  if (aiReason) return aiReason;
  return group.key === "now"
    ? isEn
      ? "Peak timing is close; open the card and verify live evidence."
      : "峰值时间接近，打开卡片核对实况证据"
    : isEn
      ? "Keep it on the action board until the next observation."
      : "先放入行动面板，等待下一轮观测";
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
          {formatShortDate(row.selected_date || row.local_date, locale)} · {row.local_time || "--"}
        </span>
        <span>{phaseMeta.label}</span>
      </div>
    </button>
  );
});

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
}

