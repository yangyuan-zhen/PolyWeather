import fs from "node:fs";
import path from "node:path";

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

  const appFactory = readRepoFile("web", "app_factory.py");
  assert(appFactory.includes("sse_router"), "FastAPI app factory must register the SSE router");

  const nginx = readRepoFile("deploy", "nginx", "polyweather.conf");
  assert(nginx.includes("location /api/events"), "Nginx deploy config must route /api/events separately");
  assert(nginx.includes("proxy_buffering off"), "Nginx /api/events must disable proxy buffering for SSE");
  assert(nginx.includes("proxy_read_timeout 86400s"), "Nginx /api/events must keep SSE connections open");

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
  assert(hook.includes("lastRevision"), "frontend patch hook must track the global last processed revision");
  assert(hook.includes("Map<"), "frontend patch hook must keep latest patches in a Map");
  assert(hook.includes("useLatestPatch"), "frontend patch hook must export useLatestPatch(city)");
  assert(hook.includes("revision"), "frontend patch hook must track revisions and skip stale patches");
  assert(hook.includes("setTimeout"), "frontend patch hook must implement explicit reconnect backoff");

  const bffEventsRoute = readFrontendFile("app", "api", "events", "route.ts");
  assert(bffEventsRoute.includes("searchParams"), "Next.js SSE proxy must forward query parameters to FastAPI");

  const chart = readFrontendFile("components", "dashboard", "scan-terminal", "LiveTemperatureThresholdChart.tsx");
  const chartCanvasPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureChartCanvas.tsx");
  const chartStatsPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureStatsBars.tsx");
  const chartRunwayPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureRunwayDetails.tsx");
  const chartTooltipPath = path.join(process.cwd(), "components", "dashboard", "scan-terminal", "TemperatureTooltipContent.tsx");
  assert(fs.existsSync(chartCanvasPath), "temperature chart Recharts canvas must live in TemperatureChartCanvas.tsx");
  assert(fs.existsSync(chartStatsPath), "temperature chart stat bars must live in TemperatureStatsBars.tsx");
  assert(fs.existsSync(chartRunwayPath), "temperature chart runway detail panel must live in TemperatureRunwayDetails.tsx");
  assert(fs.existsSync(chartTooltipPath), "temperature chart tooltip must live in TemperatureTooltipContent.tsx");
  const chartCanvas = fs.readFileSync(chartCanvasPath, "utf8");
  const chartTooltip = fs.readFileSync(chartTooltipPath, "utf8");
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
  assert(chart.includes("2 * 60_000"), "temperature chart must wait two minutes without patches before full-fetch fallback");
  assert(chart.includes("TemperatureChartCanvas"), "temperature chart shell must compose the extracted chart canvas");
  assert(chart.includes("TemperatureStatsBars"), "temperature chart shell must compose the extracted stat bars");
  assert(chart.includes("TemperatureRunwayDetails"), "temperature chart shell must compose the extracted runway panel");
  assert(!chart.includes("from \"recharts\""), "LiveTemperatureThresholdChart.tsx must not import Recharts directly");
  assert(!chart.includes("function TemperatureTooltipContent"), "LiveTemperatureThresholdChart.tsx must not define tooltip content inline");
  assert(chartCanvas.includes("TemperatureTooltipContent"), "temperature chart canvas must use a custom tooltip content component");
  assert(chartCanvas.includes("filterNull={false}"), "temperature chart tooltip must keep null-slot payload so hover works between sparse points");
  assert(chartTooltip.includes("nearestSeriesValue"), "temperature chart tooltip must fall back to nearest non-null value for connected sparse lines");
  assert(chart.includes("isHourlyLoading"), "temperature chart must keep a per-panel hourly loading state");
  assert(chartCanvas.includes("加载图表") && chartCanvas.includes("absolute inset-2"), "temperature chart must render an in-chart loading overlay");
  assert(chart.includes("hasLoadedHourlyDetailRef"), "temperature chart must distinguish first load from background refreshes");
  const fallbackRefreshBlock = chart.match(/const refreshFullDetail = \(\) => \{[\s\S]*?\n    \};/)?.[0] || "";
  assert(
    !fallbackRefreshBlock.includes("setIsHourlyLoading(true)"),
    "no-patch fallback refresh should update the chart in the background without showing the loading overlay",
  );
  const resyncBlock = chart.match(/useEffect\(\(\) => \{\s*if \(!resyncVersion \|\| !city\) return;[\s\S]*?\}, \[resyncVersion, city, targetResolution\]\);/)?.[0] || "";
  assert(
    !resyncBlock.includes("setIsHourlyLoading(true)"),
    "SSE replay resync should refresh full detail in the background without showing the loading overlay",
  );
  assert(chart.includes("viewMode"), "temperature chart must expose a view mode for DEB-peak auto view versus full-day view");
  assert(chart.includes("getDebPeakWindowRange"), "temperature chart must derive its default view from the DEB peak window");
  assert(chart.includes("nextTargetResolution"), "temperature chart must derive target resolution without setting state on every render");
  assert(
    chart.includes("targetResolution !== nextTargetResolution"),
    "temperature chart must guard target-resolution state updates to prevent render/update loops",
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
  assert(!chart.includes("3D"), "temperature chart UI must not expose a 3D/future-forecast mode");
  assert(!chart.includes("build3DayChartData"), "temperature chart component must not render future prediction curves");
  assert(
    !chart.includes("setInterval(poll, 60_000)"),
    "temperature chart must not use unconditional 60-second full-detail polling after SSE patch migration",
  );
}
