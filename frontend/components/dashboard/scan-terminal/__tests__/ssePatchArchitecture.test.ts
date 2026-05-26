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
  assert(sseManager.includes("event_stream("), "SSE manager must expose an async event_stream(user_id)");
  assert(sseManager.includes("revision"), "SSE patches must carry monotonic revision numbers");
  assert(sseManager.includes("30"), "SSE stream must include a 30-second heartbeat");
  assert(sseManager.includes("data: "), "SSE stream must emit data: JSON frames");

  const sseRouterPath = path.join(repoRoot, "web", "routers", "sse_router.py");
  assert(fs.existsSync(sseRouterPath), "FastAPI backend must define web/routers/sse_router.py");
  const sseRouter = fs.readFileSync(sseRouterPath, "utf8");
  assert(sseRouter.includes('"/api/events"'), "SSE router must expose GET /api/events");
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
  assert(hook.includes("Map<"), "frontend patch hook must keep latest patches in a Map");
  assert(hook.includes("useLatestPatch"), "frontend patch hook must export useLatestPatch(city)");
  assert(hook.includes("revision"), "frontend patch hook must track revisions and skip stale patches");
  assert(hook.includes("setTimeout"), "frontend patch hook must implement explicit reconnect backoff");

  const chart = readFrontendFile("components", "dashboard", "scan-terminal", "LiveTemperatureThresholdChart.tsx");
  assert(chart.includes("useLatestPatch"), "temperature chart must consume useLatestPatch(city)");
  assert(chart.includes("latestPatch"), "temperature chart must react to incoming SSE patches");
  assert(chart.includes("2 * 60_000"), "temperature chart must wait two minutes without patches before full-fetch fallback");
  assert(
    !chart.includes("setInterval(poll, 60_000)"),
    "temperature chart must not use unconditional 60-second full-detail polling after SSE patch migration",
  );
}
