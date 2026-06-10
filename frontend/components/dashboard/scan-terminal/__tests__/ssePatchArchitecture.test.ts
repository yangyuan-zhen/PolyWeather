import fs from "node:fs";
import path from "node:path";
import {
  __applySsePatchForTest,
  getLatestPatchesSnapshot,
} from "@/hooks/use-sse-patches";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function readRepoFile(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), "..", ...parts), "utf8");
}

function readFrontendFile(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

export function runTests() {
  const repoRoot = path.join(process.cwd(), "..");

  const sseManagerPath = path.join(repoRoot, "web", "sse_manager.py");
  assert(fs.existsSync(sseManagerPath), "FastAPI backend must define web/sse_manager.py");
  const sseManager = fs.readFileSync(sseManagerPath, "utf8");
  assert(sseManager.includes("asyncio.Queue"), "SSE manager must keep asyncio.Queue connections");
  assert(sseManager.includes("broadcast("), "SSE manager must expose broadcast(city, changes)");
  assert(sseManager.includes("broadcast_event"), "SSE manager must broadcast stored replayable events");
  assert(sseManager.includes("event_stream("), "SSE manager must expose an async event_stream(user_id)");
  assert(sseManager.includes("_queue_cities"), "SSE manager must track per-connection city subscriptions");
  assert(sseManager.includes("revision"), "SSE patches must carry monotonic revision numbers");
  assert(sseManager.includes("30"), "SSE stream must include a 30-second heartbeat");
  assert(sseManager.includes("data: "), "SSE stream must emit data: JSON frames");

  const schemaPath = path.join(repoRoot, "web", "realtime_patch_schema.py");
  assert(fs.existsSync(schemaPath), "backend must define a versioned realtime patch schema module");
  const schema = fs.readFileSync(schemaPath, "utf8");
  assert(schema.includes("city_observation_patch.v1"), "patch schema must expose city_observation_patch.v1");
  assert(schema.includes("normalize_observation_patch"), "patch schema must normalize collector payloads");
  assert(schema.includes("runway_points"), "patch schema must preserve runway point observations");

  const storePath = path.join(repoRoot, "web", "realtime_event_store.py");
  assert(fs.existsSync(storePath), "backend must define a realtime event replay store");
  const store = fs.readFileSync(storePath, "utf8");
  assert(store.includes("observation_patch_events"), "event store must use the SQLite observation_patch_events table");
  assert(store.includes("replay_events"), "event store must expose replay_events");
  assert(store.includes("replay_requires_resync"), "event store must detect incomplete replay windows");

  const redisStorePath = path.join(repoRoot, "web", "redis_realtime_event_store.py");
  assert(fs.existsSync(redisStorePath), "backend must define a Redis Stream realtime event store");
  const redisStore = fs.readFileSync(redisStorePath, "utf8");
  assert(redisStore.includes("RedisRealtimeEventStore"), "Redis store must expose RedisRealtimeEventStore");
  assert(redisStore.includes("XADD") && redisStore.includes("MAXLEN"), "Redis store must append patches to a bounded Redis Stream");
  assert(redisStore.includes("xread"), "Redis store must support live fanout through Redis Stream reads");
  assert(redisStore.includes("counter:city_observation_revision"), "Redis store must keep a numeric revision counter for frontend compatibility");

  const storeFactoryPath = path.join(repoRoot, "web", "realtime_event_store_factory.py");
  assert(fs.existsSync(storeFactoryPath), "backend must define a realtime event store factory");
  const storeFactory = fs.readFileSync(storeFactoryPath, "utf8");
  assert(storeFactory.includes("POLYWEATHER_EVENT_STORE"), "event store factory must select sqlite/redis from runtime config");
  assert(storeFactory.includes("POLYWEATHER_REDIS_REQUIRED"), "event store factory must support strict Redis mode");

  const sseRouterPath = path.join(repoRoot, "web", "routers", "sse_router.py");
  assert(fs.existsSync(sseRouterPath), "FastAPI backend must define web/routers/sse_router.py");
  const sseRouter = fs.readFileSync(sseRouterPath, "utf8");
  assert(sseRouter.includes('"/api/events"'), "SSE router must expose GET /api/events");
  assert(sseRouter.includes("cities"), "SSE route must accept a cities query parameter");
  assert(sseRouter.includes("since_revision"), "SSE route must accept since_revision for replay");
  assert(sseRouter.includes("replay_limit"), "SSE route must bound replay batches");
  assert(sseRouter.includes("resync_required"), "SSE route must emit resync_required when replay is incomplete");
  assert(sseRouter.includes('"/api/internal/collector-patch"'), "SSE router must expose collector patch ingest endpoint");
  assert(sseRouter.includes("StreamingResponse"), "SSE route must return StreamingResponse");
  assert(sseRouter.includes('"text/event-stream"'), "SSE route must use text/event-stream media type");
  assert(sseRouter.includes("create_realtime_event_store"), "SSE router must use the realtime event store factory");
  assert(sseRouter.includes("_ensure_live_subscription"), "SSE router must start external live fanout when the store provides it");
  assert(sseRouter.includes("uses_external_live_fanout"), "Redis-backed ingest must not directly broadcast duplicate local events");

  const appFactory = readRepoFile("web", "app_factory.py");
  assert(appFactory.includes("sse_router"), "FastAPI app factory must register the SSE router");

  const nginx = readRepoFile("deploy", "nginx", "polyweather.conf");
  assert(nginx.includes("location /api/events"), "Nginx deploy config must route /api/events separately");
  assert(nginx.includes("proxy_buffering off"), "Nginx /api/events must disable proxy buffering for SSE");
  assert(nginx.includes("proxy_read_timeout 86400s"), "Nginx /api/events must keep SSE connections open");
  const frontendServerStart = nginx.indexOf("server_name polyweather.top www.polyweather.top");
  const apiServerStart = nginx.indexOf("server_name api.polyweather.top");
  const frontendServer = nginx.slice(frontendServerStart, apiServerStart);
  assert(
    frontendServer.includes("location /api/events") &&
      frontendServer.includes("proxy_pass http://127.0.0.1:8000") &&
      frontendServer.indexOf("location /api/events") < frontendServer.indexOf("location / {"),
    "Nginx frontend host must route /api/events directly to FastAPI before the generic Next.js location",
  );

  const weatherSources = readRepoFile("src", "data_collection", "weather_sources.py");
  assert(weatherSources.includes("_emit_temperature_patch_if_changed"), "collector must centralize temperature patch emission");
  assert(weatherSources.includes("requests.post"), "collector must POST patches to the internal endpoint");
  assert(weatherSources.includes("/api/internal/collector-patch"), "collector must POST to /api/internal/collector-patch");
  assert(weatherSources.includes("threading.Thread"), "collector patch POST must run in a separate thread");

  const hookPath = path.join(process.cwd(), "hooks", "use-sse-patches.ts");
  assert(fs.existsSync(hookPath), "frontend must define hooks/use-sse-patches.ts");
  const hook = fs.readFileSync(hookPath, "utf8");
  assert(hook.includes("new EventSource"), "frontend patch hook must connect with EventSource");
  assert(hook.includes("/api/events"), "frontend patch hook must subscribe to /api/events");
  assert(hook.includes("city_observation_patch.v1"), "frontend patch hook must accept v1 observation patch events");
  assert(hook.includes("subscribedCities"), "frontend patch hook must track the visible city subscription set");
  assert(hook.includes("since_revision"), "frontend patch hook must reconnect with since_revision");
  assert(hook.includes("resync_required"), "frontend patch hook must react to server resync_required events");
  assert(
    hook.includes("SSE_REPLAY_EVENTS_PER_CITY") &&
      hook.includes("resolveSseReplayLimit") &&
      hook.includes('params.set("replay_limit", String(resolveSseReplayLimit(cities.length)))') &&
      !hook.includes('params.set("replay_limit", "500")'),
    "frontend patch hook should size SSE replay_limit by visible city count instead of always asking for 500 events",
  );
  assert(hook.includes("lastRevision"), "frontend patch hook must track the global last processed revision");
  assert(hook.includes("Map<"), "frontend patch hook must keep latest patches in a Map");
  assert(hook.includes("useLatestPatch"), "frontend patch hook must export useLatestPatch(city)");
  assert(hook.includes("revision"), "frontend patch hook must track revisions and skip stale patches");
  assert(hook.includes("setTimeout"), "frontend patch hook must implement explicit reconnect backoff");
  assert(
    hook.includes("SSE_SUBSCRIPTION_RECONNECT_DELAY_MS") &&
      hook.includes("scheduleSubscriptionReconnect") &&
      hook.includes("clearSubscriptionReconnectTimer"),
    "frontend patch hook must debounce visible-city subscription changes before reopening SSE",
  );
  const subscriptionBlock = hook.match(/function registerCitySubscription[\s\S]*?\n}\r?\n\r?\nfunction normalizeLegacyPatch/)?.[0] || "";
  assert(
    subscriptionBlock.includes("scheduleSubscriptionReconnect()") &&
      !subscriptionBlock.includes("ensureSsePatchConnection();"),
    "city subscription mount/unmount should schedule one coalesced SSE reconnect instead of reconnecting per chart",
  );
  const originalDateNow = Date.now;
  try {
    Date.now = () => 1_000_000;
    __applySsePatchForTest({
      type: "city_observation_patch.v1",
      city: "Latency City",
      source: "amsc_awos",
      obs_time: "2026-06-10T04:50:00Z",
      observed_at_utc: "2026-06-10T04:50:00Z",
      revision: 987001,
      ts: 940_000,
      sse_emitted_at_ms: 995_000,
      payload: {
        temp: 30.5,
        latency_sec: 64,
        received_at_utc: "2026-06-10T04:51:04Z",
      },
    });
    const latencyPatch = getLatestPatchesSnapshot().get("latency city") as any;
    assert(
      latencyPatch?.delivery?.client_received_at_ms === 1_000_000 &&
        latencyPatch?.delivery?.sse_emitted_at_ms === 995_000 &&
        latencyPatch?.delivery?.server_to_client_latency_sec === 5 &&
        latencyPatch?.delivery?.collector_to_client_latency_sec === 60 &&
        latencyPatch?.delivery?.source_to_collector_latency_sec === 64,
      "frontend patch hook should retain SSE delivery latency diagnostics for feedback context",
    );
  } finally {
    Date.now = originalDateNow;
  }

  const bffEventsRoute = readFrontendFile("app", "api", "events", "route.ts");
  assert(bffEventsRoute.includes("searchParams"), "Next.js SSE proxy must forward query parameters to FastAPI");

  const chart = readFrontendFile("components", "dashboard", "scan-terminal", "LiveTemperatureThresholdChart.tsx");
  const chartCanvasPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureChartCanvas.tsx");
  const chartStatsPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureStatsBars.tsx");
  const chartRunwayPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureRunwayDetails.tsx");
  const chartTooltipPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureTooltipContent.tsx");
  const chartSummaryPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "ModelCurvesSummary.tsx");
  assert(fs.existsSync(chartCanvasPath), "temperature chart Recharts canvas must live in TemperatureChartCanvas.tsx");
  assert(fs.existsSync(chartStatsPath), "temperature chart stat bars must live in TemperatureStatsBars.tsx");
  assert(fs.existsSync(chartRunwayPath), "temperature chart runway detail panel must live in TemperatureRunwayDetails.tsx");
  assert(fs.existsSync(chartTooltipPath), "temperature chart tooltip must live in TemperatureTooltipContent.tsx");
  assert(fs.existsSync(chartSummaryPath), "temperature chart model summary must live in ModelCurvesSummary.tsx");
  const chartCanvas = fs.readFileSync(chartCanvasPath, "utf8");
  const chartTooltip = fs.readFileSync(chartTooltipPath, "utf8");
  const chartRunway = fs.readFileSync(chartRunwayPath, "utf8");
  const chartSummary = fs.readFileSync(chartSummaryPath, "utf8");
  const chartLogicPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "temperature-chart-logic.ts");
  assert(fs.existsSync(chartLogicPath), "temperature chart pure data logic must live in temperature-chart-logic.ts");
  const chartLogic = fs.readFileSync(chartLogicPath, "utf8");
  assert(chartLogic.includes("buildFullDayChartData"), "temperature-chart-logic.ts must own full-day chart data generation");
  assert(chartLogic.includes("mergePatchIntoHourly"), "temperature-chart-logic.ts must own SSE patch merge logic");
  assert(!chart.includes("function buildFullDayChartData"), "LiveTemperatureThresholdChart.tsx must not define full-day chart data generation inline");
  assert(!chart.includes("function mergePatchIntoHourly"), "LiveTemperatureThresholdChart.tsx must not define SSE patch merge logic inline");
  assert(chart.includes("useLatestPatch"), "temperature chart must consume useLatestPatch(city)");
  assert(chart.includes("latestPatch"), "temperature chart must react to incoming SSE patches");
  assert(chart.includes("useSseResyncVersion"), "temperature chart must resync full detail when SSE replay is incomplete");
  assert(chartLogic.includes("runway_points"), "temperature chart must merge v1 runway_points into runway history");
  assert(
    chart.includes("DASHBOARD_REFRESH_POLICY_MS.metar") &&
      !chart.includes("2 * 60_000"),
    "temperature chart must keep METAR cadence for heavy patch-triggered probability refreshes",
  );
  assert(
    chart.includes("NO_PATCH_CACHED_DETAIL_REFRESH_MS = DASHBOARD_REFRESH_POLICY_MS.observation"),
    "temperature chart must use observation cadence for lightweight cached no-patch refreshes",
  );
  assert(chart.includes("TemperatureChartCanvas"), "temperature chart shell must compose the extracted chart canvas");
  assert(chart.includes("TemperatureStatsBars"), "temperature chart shell must compose the extracted stat bars");
  assert(chart.includes("TemperatureRunwayDetails"), "temperature chart shell must compose the extracted runway panel");
  assert(chart.includes("tempSymbol={row?.temp_symbol || \"°C\"}"), "temperature chart shell must pass the city temperature unit into stat bars");
  assert(chart.includes("<TemperatureRunwayDetails") && chart.includes("tempSymbol={row?.temp_symbol || \"°C\"}"), "temperature chart shell must pass the city unit into runway details");
  assert(chart.includes("<ModelCurvesSummary") && chart.includes("tempSymbol={row?.temp_symbol || \"°C\"}"), "temperature chart shell must pass the city unit into model summaries");
  const chartStats = fs.readFileSync(chartStatsPath, "utf8");
  assert(chartStats.includes("tempSymbol"), "temperature stat bars must accept the city temperature unit");
  assert(chartStats.includes("temp(displayRunwayTemp, tempSymbol)"), "temperature stat bars must render live observations with the city unit");
  assert(chartRunway.includes("tempSymbol") && !chartRunway.includes("}°C`"), "runway detail rows must render values with the city unit");
  assert(chartSummary.includes("tempSymbol") && chartSummary.includes("temp(stats.latest, tempSymbol)"), "model curve summaries must render values with the city unit");
  assert(chartCanvas.includes("const tempSymbol = row?.temp_symbol || \"°C\""), "temperature chart canvas must derive the city unit from the row");
  assert(chartCanvas.includes("tempSymbol={tempSymbol}"), "temperature chart canvas must pass the city unit into tooltips");
  assert(chartCanvas.includes("tickFormatter={(v) => `${Number(v).toFixed(0)}${tempSymbol}`}"), "temperature y-axis ticks must include °C/°F instead of a bare degree mark");
  assert(chartTooltip.includes("tempSymbol"), "temperature tooltip must accept the city temperature unit");
  assert(!chart.includes("from \"recharts\""), "LiveTemperatureThresholdChart.tsx must not import Recharts directly");
  assert(!chart.includes("function TemperatureTooltipContent"), "LiveTemperatureThresholdChart.tsx must not define tooltip content inline");
  assert(chartCanvas.includes("TemperatureTooltipContent"), "temperature chart canvas must use a custom tooltip content component");
  assert(chartCanvas.includes("filterNull={false}"), "temperature chart tooltip must keep null-slot payload so hover works between sparse points");
  assert(chartTooltip.includes("nearestSeriesValue"), "temperature chart tooltip must fall back to nearest non-null value for connected sparse lines");
  assert(chart.includes("isHourlyLoading"), "temperature chart must keep a per-panel hourly loading state");
  assert(chartCanvas.includes("加载图表") && chartCanvas.includes("absolute inset-2"), "temperature chart must render an in-chart loading overlay");
  assert(chart.includes("hasLoadedHourlyDetailRef"), "temperature chart must distinguish first load from background refreshes");
  assert(chart.includes("currentCityLocalDate"), "temperature chart must track the current city-local date while the page stays open");
  assert(chart.includes("localDayRolloverFetchDateRef"), "temperature chart must avoid duplicate midnight rollover detail fetches");
  assert(
    chart.includes("ignoreCache: true") && chart.includes("currentCityLocalDate !== loadedLocalDate"),
    "temperature chart must background-refresh full city detail when the city-local day rolls over",
  );
  const fallbackRefreshBlock = chart.match(/const refreshCachedDetail = \(\) => \{[\s\S]*?\n    \};/)?.[0] || "";
  assert(
    fallbackRefreshBlock.includes("fetchHourlyForecastForCity(city, { resolution: targetResolution })") &&
      !fallbackRefreshBlock.includes("ignoreCache: true") &&
      !fallbackRefreshBlock.includes("setIsHourlyLoading(true)"),
    "no-patch fallback refresh should update the chart through cached batch detail without force-refreshing or showing the loading overlay",
  );
  const resyncBlock = chart.match(/useEffect\(\(\) => \{\s*if \(!resyncVersion \|\| !city\) return;[\s\S]*?\}, \[resyncVersion, city, targetResolution, applySuccessfulHourlyDetail\]\);/)?.[0] || "";
  assert(
    !resyncBlock.includes("setIsHourlyLoading(true)"),
    "SSE replay resync should refresh full detail in the background without showing the loading overlay",
  );
  assert(
    chart.includes("visibilitychange") &&
      chart.includes('document.visibilityState !== "visible"') &&
      chart.includes("refreshForegroundFullDetail"),
    "temperature chart must immediately refresh visible charts when the browser tab returns to the foreground",
  );
  const foregroundRefreshBlock = chart.match(/const refreshForegroundFullDetail = \(\) => \{[\s\S]*?\n    \};/)?.[0] || "";
  assert(
    foregroundRefreshBlock.includes("ignoreCache: true") &&
      foregroundRefreshBlock.includes("fetchHourlyForecastForCity") &&
      foregroundRefreshBlock.includes("FOREGROUND_FULL_DETAIL_REFRESH_DEDUP_MS") &&
      !foregroundRefreshBlock.includes("setIsHourlyLoading(true)"),
    "foreground resume refresh should update full detail in the background without showing the loading overlay or refetching fresh detail",
  );
  assert(
    !chart.includes("/api/city/${encodeURIComponent(city)}/summary"),
    "visible chart fallback and foreground refresh should not issue a separate summary request after requesting full detail",
  );
  assert(chart.includes("viewMode"), "temperature chart must expose a view mode for DEB-peak auto view versus full-day view");
  assert(chart.includes('useState<"auto" | "full">("full")'), "temperature chart must default every city panel to the all-day view");
  assert(
    chart.includes('setViewMode("full")') && !chart.includes('setViewMode("auto")'),
    "temperature chart must reset city changes to the all-day view instead of silently switching back to the DEB peak window",
  );
  assert(chart.includes("getDebPeakWindowRange"), "temperature chart must still derive the optional Peak view from the DEB peak window");
  assert(
    chart.includes('isEn ? "Peak" : "高温"') && chart.includes('isEn ? "All Day" : "全天"'),
    "temperature chart view-mode labels must translate 高温/全天 as Peak/All Day",
  );
  assert(
    !chart.includes('isEn ? "Auto" : "高温"') && !chart.includes('isEn ? "Full" : "全天"'),
    "temperature chart view-mode labels must not expose internal Auto/Full wording",
  );
  assert(chart.includes("nextTargetResolution"), "temperature chart must derive target resolution without setting state on every render");
  assert(
    chart.includes("targetResolution !== nextTargetResolution"),
    "temperature chart must guard target-resolution state updates to prevent render/update loops",
  );
  assert(
    chart.includes("prefersHighFrequencyRunwayResolution") && chart.includes('return "1m";'),
    "runway charts must request 1-minute detail resolution so historical runway lines match live SSE patch cadence",
  );
  assert(
    chart.includes("PROBABILITY_REFRESH_AFTER_PATCH_MS") &&
      chart.includes("lastProbabilityRefreshAtRef") &&
      chart.includes("refreshProbabilityOverlayAfterPatch"),
    "temperature chart must trigger a throttled background probability refresh after live observation patches",
  );
  const patchEffectBlock = chart.match(
    /useEffect\(\(\) => \{\s*if \(!latestPatch[\s\S]*?refreshProbabilityOverlayAfterPatch\(\);[\s\S]*?\}, \[[^\]]*latestPatch[^\]]*applySuccessfulHourlyDetail[^\]]*\]\);/,
  )?.[0] || "";
  assert(
    patchEffectBlock.includes("refreshProbabilityOverlayAfterPatch") &&
      patchEffectBlock.includes("ignoreCache: true") &&
      !patchEffectBlock.includes("setIsHourlyLoading(true)"),
    "live patch probability refresh must recompute legacy Gaussian in the background without showing a loading overlay",
  );
  assert(!chartCanvas.includes("ResponsiveContainer"), "temperature chart canvas must not mount Recharts through ResponsiveContainer at 0x0");
  assert(chartCanvas.includes("ResizeObserver"), "temperature chart canvas must measure its host with ResizeObserver");
  assert(
    chartCanvas.includes("chartSize.width > 0") && chartCanvas.includes("chartSize.height > 0"),
    "temperature chart canvas must render Recharts only after positive host dimensions are measured",
  );
  assert(
    chartCanvas.includes("width={chartWidth}") && chartCanvas.includes("height={chartHeight}"),
    "temperature chart canvas must pass explicit positive width/height to Recharts",
  );
  assert(
    chartCanvas.includes("canToggleRunwayDetails") && chartCanvas.includes("individualRunwaySeriesCount > 1"),
    "single-runway charts must not show the runway-detail toggle because aggregate and individual views are visually redundant",
  );
  assert(
    chartLogic.includes("HOURLY_DETAIL_REQUEST_TIMEOUT_MS = 16_000") &&
      chartLogic.includes("fetchCityDetailBatchWithTimeout") &&
      chartLogic.includes("signal: controller.signal") &&
      chartLogic.includes("controller.abort()"),
    "city detail chart fetches must have a frontend timeout so panels cannot stay on 加载图表 forever",
  );
  assert(!chart.includes("3D"), "temperature chart UI must not expose a 3D/future-forecast mode");
  assert(!chart.includes("build3DayChartData"), "temperature chart component must not render future prediction curves");
  assert(
    !chart.includes("setInterval(poll, 60_000)"),
    "temperature chart must not use unconditional 60-second full-detail polling after SSE patch migration",
  );
}
