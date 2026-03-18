type MetricName = "INP" | "LCP" | "FCP";

export type VitalsSample = {
  id: string;
  metric: MetricName;
  navigationType: string;
  pathname: string;
  rating: string;
  timestamp: number;
  value: number;
};

type AggregatedMetric = {
  count: number;
  p75: number;
};

export type VitalsSummary = {
  generatedAt: string;
  routes: Record<string, Partial<Record<MetricName, AggregatedMetric>>>;
};

const MAX_SAMPLES = 3000;
const trackedMetrics = new Set<MetricName>(["INP", "LCP", "FCP"]);

declare global {
  // eslint-disable-next-line no-var
  var __polyweatherVitalsStore: VitalsSample[] | undefined;
}

function getStore() {
  if (!globalThis.__polyweatherVitalsStore) {
    globalThis.__polyweatherVitalsStore = [];
  }
  return globalThis.__polyweatherVitalsStore;
}

function toPercentile(values: number[], percentile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.ceil(percentile * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, position));
  return sorted[index];
}

export function normalizeMetricName(input: unknown): MetricName | null {
  const value = String(input || "").trim().toUpperCase() as MetricName;
  return trackedMetrics.has(value) ? value : null;
}

export function recordVitalsSample(sample: VitalsSample) {
  const store = getStore();
  store.push(sample);
  if (store.length > MAX_SAMPLES) {
    store.splice(0, store.length - MAX_SAMPLES);
  }
}

export function getVitalsSummary(): VitalsSummary {
  const store = getStore();
  const grouped: Record<string, Record<MetricName, number[]>> = {};

  for (const item of store) {
    const route = item.pathname || "/";
    const metric = item.metric;
    grouped[route] ||= { FCP: [], INP: [], LCP: [] };
    grouped[route][metric].push(item.value);
  }

  const routes: VitalsSummary["routes"] = {};
  Object.entries(grouped).forEach(([route, byMetric]) => {
    const routeStats: Partial<Record<MetricName, AggregatedMetric>> = {};
    (["INP", "LCP", "FCP"] as const).forEach((metric) => {
      const values = byMetric[metric];
      if (!values.length) return;
      routeStats[metric] = {
        count: values.length,
        p75: Number(toPercentile(values, 0.75).toFixed(2)),
      };
    });
    routes[route] = routeStats;
  });

  return {
    generatedAt: new Date().toISOString(),
    routes,
  };
}
