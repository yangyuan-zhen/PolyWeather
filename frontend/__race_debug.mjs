// 验证"加载后丢失": 后端 detail-batch 有时返回空 runway_plate_history
// 当 force_refresh 的空响应覆盖了之前有数据的状态

const _hourlyCache = new Map();
const _hourlyRequestCache = new Map();
let requestCounter = 0;

// 模拟后端: detail-batch 间歇性返回空 runway_plate_history
// (之前线上验证: 成都 runway_plate_history 全空, 但有时 SSE patch 会带数据)
function mockFetch(city, opts = {}) {
  const forceRefresh = opts.ignoreCache;
  const bypassLocalCache = opts.bypassLocalCache;
  const resParam = opts.resolution || "10m";
  const cacheKey = `${city}:${resParam}`;
  if (!forceRefresh && !bypassLocalCache) {
    const cached = _hourlyCache.get(cacheKey);
    if (cached) return Promise.resolve(cached.data);
  }
  const requestKey = forceRefresh ? `${cacheKey}:live` : bypassLocalCache ? `${cacheKey}:revalidate` : cacheKey;
  const pending = _hourlyRequestCache.get(requestKey);
  if (pending) return pending;
  const id = ++requestCounter;
  const p = new Promise((resolve) => {
    setTimeout(() => {
      // 30% 概率返回空 runway (模拟后端间歇性失败)
      const isEmpty = Math.random() < 0.3;
      const data = {
        requestId: id,
        localDate: "2026-06-15",
        times: ["00:00", "12:00"],
        temps: [25, 30],
        runwayPlateHistory: {},
        amos: null,
        airportCurrent: { temp: 25.8, obs_time: "01:00" },
        probabilities: { engine: "legacy", distribution: [] },
      };
      if (!isEmpty) _hourlyCache.set(cacheKey, { ts: Date.now(), data });
      resolve(data);
    }, 300 + Math.random() * 400);
  }).finally(() => _hourlyRequestCache.delete(requestKey));
  _hourlyRequestCache.set(requestKey, p);
  return p;
}

// 复刻 mergeHourlyWithLiveObservations 简化版
function merge(base, live) {
  if (!base) return live;
  if (!live) return base;
  return {
    ...live,
    runwayPlateHistory: { ...(base.runwayPlateHistory || {}), ...(live.runwayPlateHistory || {}) },
    amos: live.amos || base.amos,
  };
}

let hourly = null;
let history = [];
function snapshot(label) {
  const rwy = hourly?.runwayPlateHistory ? Object.keys(hourly.runwayPlateHistory) : [];
  const hasRunway = rwy.length > 0;
  history.push({ t: Date.now(), label, hasRunway, rwy: rwy.join(",") || "(空)" });
  console.log(`  [${label}] runwayPlateHistory = ${rwy.join(",") || "❌空"} | amos=${hourly?.amos?.source || "null"}`);
}

let cleanup = null;
function effect773(city, row, resolution) {
  if (cleanup) cleanup();
  const cacheKey = `${city}:${resolution}`;
  const cached = _hourlyCache.get(cacheKey);
  if (cached) { hourly = merge(hourly, cached.data); }
  let cancelled = false;
  mockFetch(city, { resolution }).then((data) => {
    if (cancelled) return;
    hourly = merge(hourly, data);
    snapshot("effect773 应用 detail");
  });
  cleanup = () => { cancelled = true; };
}

function effect905patch(city, resolution) {
  let cancelled = false;
  // SSE patch 后的 force_refresh
  mockFetch(city, { ignoreCache: true, resolution }).then((data) => {
    if (cancelled) return;
    hourly = merge(hourly, data);  // 如果 data.runwayPlateHistory 空,merge 后仍是空的
    snapshot("effect905 force_refresh 应用");
  });
  cleanup905 = () => { cancelled = true; };
}
let cleanup905 = null;

console.log("=== '加载后丢失' 模拟 ===\n");
console.log("T0: 首次加载 detail");
effect773("chengdu", "R1", "10m");

setTimeout(() => {
  console.log("T500ms: SSE patch 到达, 触发 force_refresh");
  effect905patch("chengdu", "10m");
}, 500);

setTimeout(() => {
  console.log("T1000ms: 又一次 patch");
  effect905patch("chengdu", "10m");
}, 1000);

setTimeout(() => {
  console.log("\n=== T1.5s 最终 ===");
  snapshot("最终");
  console.log("\n历史轨迹:");
  history.forEach((h, i) => console.log(`  ${i}: ${h.label} → ${h.rwy}`));
}, 1500);
