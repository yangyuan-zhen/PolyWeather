export const MONITOR_CITY_DETAIL_DEPTH = "panel" as const;
export const MONITOR_REFRESH_INTERVAL_MS = 300_000;

export type MonitorRefreshTrigger = "initial" | "interval";

export function getMonitorRefreshRequest(_trigger: MonitorRefreshTrigger) {
  return {
    depth: MONITOR_CITY_DETAIL_DEPTH,
    force: true,
  };
}
