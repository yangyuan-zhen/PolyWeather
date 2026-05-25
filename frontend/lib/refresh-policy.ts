export const DASHBOARD_REFRESH_POLICY_SEC = {
  observation: 60,
  metar: 5 * 60,
  scanRows: 5 * 60,
  marketOverview: 10 * 60,
  model: 30 * 60,
} as const;

export const DASHBOARD_REFRESH_POLICY_MS = {
  observation: DASHBOARD_REFRESH_POLICY_SEC.observation * 1000,
  metar: DASHBOARD_REFRESH_POLICY_SEC.metar * 1000,
  scanRows: DASHBOARD_REFRESH_POLICY_SEC.scanRows * 1000,
  marketOverview: DASHBOARD_REFRESH_POLICY_SEC.marketOverview * 1000,
  model: DASHBOARD_REFRESH_POLICY_SEC.model * 1000,
} as const;
