const DEFAULT_CONFIG = {
  apiBase: "https://polyweather-pro.vercel.app",
  authToken: "",
  selectedCity: "",
  siteBase: "https://polyweather-pro.vercel.app"
};
const CACHE_VERSION = "v1";
const locale = String(navigator.language || "en").toLowerCase().startsWith("zh")
  ? "zh"
  : "en";
const I18N = {
  zh: {
    loadingWeather: "正在加载温度数据...",
    loadingWeatherRefresh: "正在刷新最新温度数据...",
    loadingCities: "正在加载城市列表...",
    riskLow: "低风险",
    riskMedium: "中风险",
    riskHigh: "高风险",
    settlementSource: "结算源",
    settlementAirport: "结算机场",
    hko: "香港天文台 (HKO)",
    cwa: "交通部中央气象署 (CWA)",
    city: "城市",
    refresh: "刷新数据",
    cityProfile: "城市档案",
    distance: "站点距离",
    obsUpdate: "观测更新",
    nearbyStations: "周边站点",
    intradayTrend: "今日日内走势（简版）",
    forecast: "多日预报",
    openFull: "打开完整网站分析",
    noTrendData: "暂无趋势数据",
    noForecast: "暂无多日预报",
    noContinuousObs: "暂无连续观测",
    nearbyMonitoringSuffix: "个参与监控",
    today: "今天",
    omSeries: "OM预测",
    loadCityDetailFailed: "加载城市详情失败",
    refreshFailed: "刷新温度数据失败",
    initFailed: "初始化失败",
    publicReadHint: "当前插件是公开读模式，Token 可留空。请检查后端是否仍开启了接口鉴权。",
    publicModeHint: "公开模式只需配置 API Base；Token 可留空。",
    freshnessRecent: "数据约 {minutes} 分钟前更新。",
    freshnessWarn: "数据已 {minutes} 分钟未更新，建议点右上角刷新。",
    freshnessStale: "数据已 {minutes} 分钟未更新，当前结果可能偏旧，请立即刷新。"
  },
  en: {
    loadingWeather: "Loading weather data...",
    loadingWeatherRefresh: "Refreshing latest weather data...",
    loadingCities: "Loading city list...",
    riskLow: "Low Risk",
    riskMedium: "Medium Risk",
    riskHigh: "High Risk",
    settlementSource: "Settlement Source",
    settlementAirport: "Settlement Airport",
    hko: "Hong Kong Observatory (HKO)",
    cwa: "Central Weather Administration (CWA)",
    city: "City",
    refresh: "Refresh data",
    cityProfile: "City Profile",
    distance: "Station Distance",
    obsUpdate: "Observation Update",
    nearbyStations: "Nearby Stations",
    intradayTrend: "Today's Intraday Trend",
    forecast: "Forecast",
    openFull: "Open Full Site Analysis",
    noTrendData: "No trend data available",
    noForecast: "No multi-day forecast",
    noContinuousObs: "No continuous observations",
    nearbyMonitoringSuffix: " stations monitored",
    today: "Today",
    omSeries: "OM Forecast",
    loadCityDetailFailed: "Failed to load city detail",
    refreshFailed: "Failed to refresh weather data",
    initFailed: "Initialization failed",
    publicReadHint: "The extension is in public read mode. Token can be empty. Check whether the backend still requires auth.",
    publicModeHint: "In public mode only API Base is required; Token can be empty.",
    freshnessRecent: "Data updated about {minutes} min ago.",
    freshnessWarn: "Data is {minutes} min old. Consider refreshing.",
    freshnessStale: "Data is {minutes} min old and may be stale. Refresh now."
  }
};

function t(key) {
  return I18N[locale][key] || I18N.zh[key] || key;
}

let state = {
  config: { ...DEFAULT_CONFIG },
  cities: [],
  detail: null,
  lastActiveUrl: "",
  syncBusy: false,
  loadingCount: 0,
  chartHover: {
    points: [],
    tempSymbol: "°C"
  }
};

const els = {
  citySelect: document.getElementById("citySelect"),
  refreshBtn: document.getElementById("refreshBtn"),
  riskBadge: document.getElementById("riskBadge"),
  settlementLabel: document.getElementById("settlementLabel"),
  settlementValue: document.getElementById("settlementValue"),
  distanceValue: document.getElementById("distanceValue"),
  obsTimeValue: document.getElementById("obsTimeValue"),
  nearbyValue: document.getElementById("nearbyValue"),
  trendCanvas: document.getElementById("trendCanvas"),
  chartTooltip: document.getElementById("chartTooltip"),
  chartLegend: document.getElementById("chartLegend"),
  forecastRow: document.getElementById("forecastRow"),
  errorBox: document.getElementById("errorBox"),
  openFullBtn: document.getElementById("openFullBtn"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
  cityLabel: document.getElementById("cityLabel"),
  profileTitle: document.getElementById("profileTitle"),
  distanceLabel: document.getElementById("distanceLabel"),
  obsTimeLabel: document.getElementById("obsTimeLabel"),
  nearbyLabel: document.getElementById("nearbyLabel"),
  trendTitle: document.getElementById("trendTitle"),
  forecastTitle: document.getElementById("forecastTitle")
  ,
  freshnessHint: document.getElementById("freshnessHint")
};

function normalizeBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function buildCacheKey(kind, cityName = "") {
  const apiBase = normalizeBase(state.config?.apiBase || DEFAULT_CONFIG.apiBase);
  const city = String(cityName || "").trim().toLowerCase();
  return `polyweather:${CACHE_VERSION}:${apiBase}:${kind}:${city}`;
}

async function getLocalValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (items) => {
      resolve(items?.[key] ?? null);
    });
  });
}

async function setLocalValue(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

function normalizeForMatch(value) {
  let out = decodeURIComponent(String(value || "")).toLowerCase();
  try {
    out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_e) {
    // Ignore unicode normalization failures.
  }
  return out;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCityAliasTokens(rawCityName) {
  const normalized = normalizeForMatch(rawCityName).trim().replace(/\s+/g, " ");
  const compact = normalized.replace(/\s+/g, "");
  const hyphen = normalized.replace(/\s+/g, "-");
  const aliases = new Set([normalized, compact, hyphen]);

  if (normalized === "hong kong") {
    aliases.add("hongkong");
    aliases.add("hong-kong");
    aliases.add("hk");
  }
  if (normalized === "taipei") {
    aliases.add("taipei-city");
    aliases.add("tp");
    aliases.add("tpe");
  }
  if (normalized === "new york") {
    aliases.add("new-york");
    aliases.add("nyc");
  }
  if (normalized === "sao paulo") {
    aliases.add("sao-paulo");
    aliases.add("saopaulo");
  }
  if (normalized === "tel aviv") {
    aliases.add("tel-aviv");
    aliases.add("telaviv");
  }
  if (normalized === "buenos aires") {
    aliases.add("buenos-aires");
    aliases.add("buenosaires");
  }

  return [...aliases].filter((item) => item && item.length >= 2);
}

function getCityAliasIndex() {
  const out = [];
  for (const city of state.cities) {
    const names = [
      String(city?.name || ""),
      String(city?.display_name || "")
    ];
    const seen = new Set();
    for (const name of names) {
      for (const alias of getCityAliasTokens(name)) {
        if (seen.has(alias)) continue;
        seen.add(alias);
        out.push({ alias, cityName: city.name });
      }
    }
  }
  out.sort((a, b) => b.alias.length - a.alias.length);
  return out;
}

function matchCityInText(text) {
  const target = normalizeForMatch(text);
  if (!target) return "";
  const aliasIndex = getCityAliasIndex();
  for (const row of aliasIndex) {
    const alias = row.alias;
    if (!alias) continue;
    if (/^[a-z0-9-]+$/.test(alias)) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`);
      if (re.test(target)) return row.cityName;
    } else if (target.includes(alias)) {
      return row.cityName;
    }
  }
  return "";
}

function inferCityFromUrl(url) {
  if (!url) return "";
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (_e) {
    parsed = null;
  }

  if (parsed) {
    const queryCity = parsed.searchParams.get("city") || parsed.searchParams.get("c");
    if (queryCity) {
      const byQuery = matchCityInText(queryCity);
      if (byQuery) return byQuery;
    }

    const hostPath = `${parsed.hostname} ${parsed.pathname} ${parsed.hash || ""}`;
    const byPath = matchCityInText(hostPath);
    if (byPath) return byPath;
  }

  return matchCityInText(url);
}

function showError(message) {
  els.errorBox.textContent = message;
  els.errorBox.classList.remove("hidden");
}

function tf(key, params = {}) {
  let text = t(key);
  for (const [name, value] of Object.entries(params)) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

function clearError() {
  els.errorBox.textContent = "";
  els.errorBox.classList.add("hidden");
}

function setLoading(loading, text = t("loadingWeather")) {
  if (!els.loadingOverlay) return;
  if (loading) {
    state.loadingCount += 1;
  } else {
    state.loadingCount = Math.max(0, state.loadingCount - 1);
  }
  const isVisible = state.loadingCount > 0;
  els.loadingOverlay.classList.toggle("hidden", !isVisible);
  if (isVisible && els.loadingText) {
    els.loadingText.textContent = text;
  }
}

function hideChartTooltip() {
  if (!els.chartTooltip) return;
  els.chartTooltip.classList.add("hidden");
}

function setChartHover(points, tempSymbol) {
  state.chartHover = {
    points: Array.isArray(points) ? points : [],
    tempSymbol: tempSymbol || "°C"
  };
  if (!state.chartHover.points.length) {
    hideChartTooltip();
  }
}

function onTrendCanvasHover(event) {
  const canvas = els.trendCanvas;
  const tooltip = els.chartTooltip;
  const hoverPoints = state.chartHover?.points || [];
  if (!canvas || !tooltip || !hoverPoints.length) {
    hideChartTooltip();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(rect.width, 1);
  const scaleY = canvas.height / Math.max(rect.height, 1);
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) {
    hideChartTooltip();
    return;
  }

  let nearest = null;
  let nearestDistSq = Number.POSITIVE_INFINITY;
  for (const p of hoverPoints) {
    const dx = p.x - x;
    const dy = p.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = p;
    }
  }

  if (!nearest) {
    hideChartTooltip();
    return;
  }

  const symbol = state.chartHover?.tempSymbol || "°C";
  tooltip.textContent = `${nearest.series} ${nearest.time} ${nearest.value.toFixed(1)}${symbol}`;
  tooltip.classList.remove("hidden");

  const wrap = canvas.parentElement;
  if (!wrap) return;
  const wrapRect = wrap.getBoundingClientRect();
  const localX = event.clientX - wrapRect.left;
  const localY = event.clientY - wrapRect.top;
  let left = localX + 10;
  let top = localY - 28;

  const tipW = tooltip.offsetWidth || 120;
  const tipH = tooltip.offsetHeight || 28;
  if (left + tipW + 8 > wrap.clientWidth) left = wrap.clientWidth - tipW - 8;
  if (left < 8) left = 8;
  if (top < 8) top = localY + 12;
  if (top + tipH + 8 > wrap.clientHeight) top = wrap.clientHeight - tipH - 8;

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function setRefreshing(isRefreshing) {
  if (!els.refreshBtn) return;
  els.refreshBtn.disabled = Boolean(isRefreshing);
  els.refreshBtn.classList.toggle("spinning", Boolean(isRefreshing));
}

function riskText(level) {
  const low = String(level || "medium").toLowerCase();
  if (low === "low") return t("riskLow");
  if (low === "high") return t("riskHigh");
  return t("riskMedium");
}

function getSettlementSourceDisplay(detail) {
  const source = String(detail?.current?.settlement_source || "").toLowerCase();
  if (source === "hko") {
    return {
      label: t("settlementSource"),
      value: t("hko")
    };
  }
  if (source === "cwa") {
    return {
      label: t("settlementSource"),
      value: t("cwa")
    };
  }
  const airport = detail?.risk?.airport || "--";
  const icao = detail?.risk?.icao ? ` (${detail.risk.icao})` : "";
  return {
    label: t("settlementAirport"),
    value: `${airport}${icao}`
  };
}

function formatTemp(v, symbol) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return `${n.toFixed(1)}${symbol || "°C"}`;
}

function formatForecastDate(day, index) {
  if (index === 0) return t("today");
  const str = String(day || "");
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return str || "--";
  return `${m[2]}/${m[3]}`;
}

function parseIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function renderFreshness(detail) {
  if (!els.freshnessHint) return;
  const updatedAt = parseIsoDate(detail?.updated_at);
  if (!updatedAt) {
    els.freshnessHint.classList.add("hidden");
    els.freshnessHint.classList.remove("stale");
    els.freshnessHint.textContent = "";
    return;
  }

  const minutes = Math.max(
    0,
    Math.round((Date.now() - updatedAt.getTime()) / 60000)
  );

  if (minutes < 8) {
    els.freshnessHint.classList.add("hidden");
    els.freshnessHint.classList.remove("stale");
    els.freshnessHint.textContent = "";
    return;
  }

  const isStale = minutes >= 20;
  els.freshnessHint.classList.remove("hidden");
  els.freshnessHint.classList.toggle("stale", isStale);
  els.freshnessHint.textContent = isStale
    ? tf("freshnessStale", { minutes })
    : tf("freshnessWarn", { minutes });
}

function parseTimeToMinute(value) {
  const text = String(value || "");
  const m = text.match(/(\d{1,2}):(\d{2})/);
  if (!m) return Number.NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.NaN;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return Number.NaN;
  return hh * 60 + mm;
}

function getObservationRows(detail) {
  const obsSource = Array.isArray(detail?.settlement_today_obs) && detail.settlement_today_obs.length
    ? detail.settlement_today_obs
    : Array.isArray(detail?.metar_today_obs)
      ? detail.metar_today_obs
      : [];

  const rows = [];
  for (const row of obsSource) {
    const temp = Number(row?.temp);
    const time = String(row?.time || "");
    if (!Number.isFinite(temp) || !time) continue;
    rows.push({
      temp,
      time,
      minute: parseTimeToMinute(time)
    });
  }

  const sortable = rows.every((row) => Number.isFinite(row.minute));
  if (sortable) {
    rows.sort((a, b) => a.minute - b.minute);
  }
  return rows;
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
      resolve({
        apiBase: normalizeBase(items.apiBase || DEFAULT_CONFIG.apiBase),
        siteBase: normalizeBase(items.siteBase || items.apiBase || DEFAULT_CONFIG.siteBase),
        authToken: String(items.authToken || ""),
        selectedCity: String(items.selectedCity || "")
      });
    });
  });
}

async function saveConfigPatch(patch) {
  const next = { ...state.config, ...patch };
  state.config = next;
  return new Promise((resolve) => {
    chrome.storage.sync.set(next, resolve);
  });
}

async function getCachedCities() {
  const cached = await getLocalValue(buildCacheKey("cities"));
  const cities = cached?.cities;
  return Array.isArray(cities) && cities.length ? cities : null;
}

async function setCachedCities(cities) {
  if (!Array.isArray(cities) || !cities.length) return;
  await setLocalValue(buildCacheKey("cities"), {
    updated_at: new Date().toISOString(),
    cities
  });
}

async function getCachedDetail(cityName) {
  if (!cityName) return null;
  const cached = await getLocalValue(buildCacheKey("detail", cityName));
  return cached?.detail || null;
}

async function setCachedDetail(cityName, detail) {
  if (!cityName || !detail || typeof detail !== "object") return;
  await setLocalValue(buildCacheKey("detail", cityName), {
    updated_at: new Date().toISOString(),
    detail
  });
}

async function setSelectedCity(cityName, options = {}) {
  const { persist = true, reloadDetail = true } = options;
  const target = String(cityName || "");
  if (!target) return;
  if (!state.cities.find((city) => city.name === target)) return;

  const changed = state.config.selectedCity !== target;
  state.config.selectedCity = target;
  if (changed && persist) {
    await saveConfigPatch({ selectedCity: target });
  }
  renderCitySelect();
  if (reloadDetail) {
    await loadDetail(target);
  }
}

async function apiGet(path) {
  const headers = { Accept: "application/json" };
  if (state.config.authToken) {
    headers.Authorization = `Bearer ${state.config.authToken}`;
  }
  const url = `${normalizeBase(state.config.apiBase)}${path}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_e) {
    data = text;
  }
  if (!res.ok) {
    const errMsg = typeof data === "object" && data
      ? JSON.stringify(data)
      : String(data || res.statusText);
    throw new Error(`HTTP ${res.status}: ${errMsg}`);
  }
  return data;
}

function renderCitySelect() {
  const current = state.config.selectedCity;
  els.citySelect.innerHTML = "";
  for (const c of state.cities) {
    const op = document.createElement("option");
    op.value = c.name;
    op.textContent = c.display_name || c.name;
    if (c.name === current) op.selected = true;
    els.citySelect.appendChild(op);
  }
}

function renderRiskBadge(detail) {
  const lvl = String(detail?.risk?.level || "medium").toLowerCase();
  els.riskBadge.classList.remove("low", "medium", "high");
  els.riskBadge.classList.add(lvl === "low" || lvl === "high" ? lvl : "medium");
  els.riskBadge.textContent = riskText(lvl);
}

function extractTrendSeries(detail) {
  const hourly = detail?.hourly || {};
  const times = Array.isArray(hourly.times) ? hourly.times : [];
  const temps = Array.isArray(hourly.temps) ? hourly.temps : [];
  const trend = [];
  for (let i = 0; i < times.length; i += 1) {
    const t = Number(temps[i]);
    if (!Number.isFinite(t)) continue;
    const timeText = String(times[i]);
    trend.push({ t: timeText, v: t, m: parseTimeToMinute(timeText) });
  }

  const obs = [];
  for (const row of getObservationRows(detail)) {
    obs.push({ t: row.time, v: row.temp, m: row.minute });
  }
  return { trend, obs };
}

function drawTrendChart(detail) {
  const canvas = els.trendCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const { trend, obs } = extractTrendSeries(detail);
  const points = [...trend, ...obs];
  const hoverPoints = [];
  const tempSymbol = detail?.temp_symbol || "°C";
  const obsSeriesLabel = String(detail?.current?.settlement_source_label || "OBS").toUpperCase();
  if (!points.length) {
    setChartHover([], tempSymbol);
    ctx.fillStyle = "#8ba0be";
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText(t("noTrendData"), 18, 40);
    return;
  }

  const minVal = Math.min(...points.map((p) => p.v));
  const maxVal = Math.max(...points.map((p) => p.v));
  const vPad = Math.max(1, (maxVal - minVal) * 0.2);
  const yMin = minVal - vPad;
  const yMax = maxVal + vPad;
  const inner = { left: 38, top: 16, right: width - 12, bottom: height - 30 };
  const w = inner.right - inner.left;
  const h = inner.bottom - inner.top;

  const minuteValues = points.map((p) => p.m).filter((v) => Number.isFinite(v));
  const canUseMinuteAxis = minuteValues.length >= 2 && Math.max(...minuteValues) > Math.min(...minuteValues);
  const minMinute = canUseMinuteAxis ? Math.min(...minuteValues) : 0;
  const maxMinute = canUseMinuteAxis ? Math.max(...minuteValues) : 0;

  function xFromIndex(idx, total) {
    if (total <= 1) return inner.left;
    return inner.left + (idx / (total - 1)) * w;
  }
  function xFromMinute(minute) {
    if (!canUseMinuteAxis || !Number.isFinite(minute)) return inner.left;
    return inner.left + ((minute - minMinute) / (maxMinute - minMinute)) * w;
  }
  function yFromValue(v) {
    return inner.bottom - ((v - yMin) / (yMax - yMin)) * h;
  }

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = inner.top + (h / 3) * i;
    ctx.beginPath();
    ctx.moveTo(inner.left, y);
    ctx.lineTo(inner.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#7f95b2";
  ctx.font = "12px Inter, sans-serif";
  for (let i = 0; i < 4; i += 1) {
    const val = yMax - ((yMax - yMin) / 3) * i;
    const y = inner.top + (h / 3) * i + 4;
    ctx.fillText(`${val.toFixed(0)}°`, 6, y);
  }

  if (trend.length) {
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    trend.forEach((p, idx) => {
      const x = canUseMinuteAxis ? xFromMinute(p.m) : xFromIndex(idx, trend.length);
      const y = yFromValue(p.v);
      hoverPoints.push({ x, y, time: p.t, value: p.v, series: t("omSeries") });
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  if (obs.length) {
    ctx.strokeStyle = "rgba(34, 211, 238, 0.9)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < obs.length; i += 1) {
      const x = canUseMinuteAxis ? xFromMinute(obs[i].m) : xFromIndex(i, obs.length);
      const y = yFromValue(obs[i].v);
      hoverPoints.push({ x, y, time: obs[i].t, value: obs[i].v, series: obsSeriesLabel });
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Keep dots sparse to avoid a "full row of points" look.
    const markerStep = Math.max(1, Math.ceil(obs.length / 12));
    ctx.fillStyle = "#22d3ee";
    for (let i = 0; i < obs.length; i += markerStep) {
      const x = canUseMinuteAxis ? xFromMinute(obs[i].m) : xFromIndex(i, obs.length);
      const y = yFromValue(obs[i].v);
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Always draw last marker for latest observation.
    const lastObs = obs[obs.length - 1];
    const lastX = canUseMinuteAxis ? xFromMinute(lastObs.m) : xFromIndex(obs.length - 1, obs.length);
    const lastY = yFromValue(lastObs.v);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const ticks = trend.length ? trend : obs;
  ctx.fillStyle = "#7f95b2";
  ctx.font = "11px Inter, sans-serif";
  const step = Math.max(1, Math.floor(ticks.length / 4));
  for (let i = 0; i < ticks.length; i += step) {
    const x = canUseMinuteAxis ? xFromMinute(ticks[i].m) : xFromIndex(i, ticks.length);
    const text = String(ticks[i].t).slice(0, 5);
    ctx.fillText(text, x - 12, height - 8);
  }

  setChartHover(hoverPoints, tempSymbol);
}

function renderForecast(detail) {
  const symbol = detail?.temp_symbol || "°C";
  const daily = Array.isArray(detail?.forecast?.daily) ? detail.forecast.daily : [];
  els.forecastRow.innerHTML = "";
  for (let i = 0; i < Math.min(daily.length, 6); i += 1) {
    const day = daily[i];
    const card = document.createElement("div");
    card.className = `forecast-card ${i === 0 ? "today" : ""}`;

    const d = document.createElement("div");
    d.className = "f-date";
    d.textContent = formatForecastDate(day?.date, i);
    card.appendChild(d);

    const v = document.createElement("div");
    v.className = "f-temp";
    v.textContent = formatTemp(day?.max_temp, symbol);
    card.appendChild(v);

    els.forecastRow.appendChild(card);
  }
  if (!daily.length) {
    els.forecastRow.textContent = t("noForecast");
  }
}

function renderDetail(detail) {
  state.detail = detail;
  renderRiskBadge(detail);
  renderFreshness(detail);

  const profile = getSettlementSourceDisplay(detail);
  els.settlementLabel.textContent = profile.label;
  els.settlementValue.textContent = profile.value;
  els.distanceValue.textContent = Number.isFinite(Number(detail?.risk?.distance_km))
    ? `${Number(detail.risk.distance_km)} km`
    : "--";
  els.obsTimeValue.textContent = detail?.current?.obs_time || "--";
  const nearby = Array.isArray(detail?.mgm_nearby) ? detail.mgm_nearby.length : 0;
  els.nearbyValue.textContent = locale === "zh"
    ? `${nearby} ${t("nearbyMonitoringSuffix")}`
    : `${nearby}${t("nearbyMonitoringSuffix")}`;

  drawTrendChart(detail);
  renderForecast(detail);

  const sourceTag = String(detail?.current?.settlement_source_label || "").toUpperCase() || "OBS";
  const obs = getObservationRows(detail);
  if (obs.length >= 2) {
    const first = obs[0];
    const last = obs[obs.length - 1];
    els.chartLegend.textContent = `${sourceTag}: ${first.temp}°C@${first.time} -> ${last.temp}°C@${last.time}`;
  } else {
    els.chartLegend.textContent = `${sourceTag}: ${t("noContinuousObs")}`;
  }
}

function normalizeAggregateDetail(payload) {
  const overview = payload?.overview || {};
  const risk = payload?.risk || {};
  const officialCurrent = payload?.official?.metar?.current || {};
  const timeseries = payload?.timeseries || {};
  const probs = payload?.probabilities || {};

  return {
    name: overview.name || payload.city || "",
    display_name: overview.display_name || overview.name || payload.city || "",
    lat: overview.lat,
    lon: overview.lon,
    temp_symbol: overview.temp_symbol || "°C",
    local_time: overview.local_time,
    local_date: overview.local_date,
    risk: {
      level: risk.level || overview.risk_level || "medium",
      emoji: risk.emoji,
      airport: risk.airport || overview.airport,
      icao: risk.icao || overview.icao,
      distance_km: risk.distance_km,
      warning: risk.warning || overview.risk_warning
    },
    current: {
      ...(officialCurrent || {}),
      settlement_source: overview.settlement_source || officialCurrent?.settlement_source,
      settlement_source_label:
        overview.settlement_source_label || officialCurrent?.settlement_source_label
    },
    mgm_nearby: payload?.official?.mgm_nearby || [],
    forecast: {
      daily: Array.isArray(timeseries.forecast_daily) ? timeseries.forecast_daily : []
    },
    hourly: timeseries.hourly || { times: [], temps: [] },
    metar_today_obs: timeseries.metar_today_obs || [],
    settlement_today_obs: timeseries.settlement_today_obs || [],
    probabilities: probs || { mu: null, distribution: [] },
    updated_at: payload?.fetched_at
  };
}

function applyStaticTranslations() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  if (els.cityLabel) els.cityLabel.textContent = t("city");
  if (els.profileTitle) els.profileTitle.textContent = t("cityProfile");
  if (els.distanceLabel) els.distanceLabel.textContent = t("distance");
  if (els.obsTimeLabel) els.obsTimeLabel.textContent = t("obsUpdate");
  if (els.nearbyLabel) els.nearbyLabel.textContent = t("nearbyStations");
  if (els.trendTitle) els.trendTitle.textContent = t("intradayTrend");
  if (els.forecastTitle) els.forecastTitle.textContent = t("forecast");
  if (els.openFullBtn) els.openFullBtn.textContent = t("openFull");
  if (els.refreshBtn) {
    els.refreshBtn.title = t("refresh");
    els.refreshBtn.setAttribute("aria-label", t("refresh"));
  }
  if (els.loadingText && state.loadingCount === 0) {
    els.loadingText.textContent = t("loadingWeather");
  }
}

async function loadDetail(cityName, options = {}) {
  const { forceRefresh = false } = options;
  const targetCity = String(cityName || "");
  if (!targetCity) return { fromCache: false };

  const cachedDetail = await getCachedDetail(targetCity);
  if (!forceRefresh && cachedDetail) {
    renderDetail(cachedDetail);
    return { fromCache: true };
  }

  setLoading(true, forceRefresh ? t("loadingWeatherRefresh") : t("loadingWeather"));
  try {
    const encoded = encodeURIComponent(targetCity);
    const suffix = forceRefresh ? "?force_refresh=1" : "";
    let detail = null;
    try {
      // Preferred legacy endpoint: already matches frontend card schema.
      detail = await apiGet(`/api/city/${encoded}${suffix}`);
    } catch (_legacyErr) {
      // Fallback to aggregate endpoint and normalize structure.
      const payload = await apiGet(`/api/city/${encoded}/detail${suffix}`);
      detail =
        payload && payload.overview && payload.timeseries
          ? normalizeAggregateDetail(payload)
          : payload;
    }
    renderDetail(detail);
    await setCachedDetail(targetCity, detail);
    return { fromCache: false };
  } catch (err) {
    if (cachedDetail) {
      renderDetail(cachedDetail);
    }
    throw err;
  } finally {
    setLoading(false);
  }
}

async function loadCities(options = {}) {
  const { forceRefresh = false } = options;

  const applyCities = async (cities) => {
    state.cities = cities;
    if (!state.config.selectedCity || !cities.find((c) => c.name === state.config.selectedCity)) {
      const preferred = cities.find((c) => c.is_major) || cities[0];
      await setSelectedCity(preferred.name, { persist: true, reloadDetail: false });
    } else {
      renderCitySelect();
    }
  };

  const cachedCities = await getCachedCities();
  if (!forceRefresh && cachedCities) {
    await applyCities(cachedCities);
    return { fromCache: true };
  }

  setLoading(true, t("loadingCities"));
  try {
    const list = await apiGet("/api/cities");
    const cities = Array.isArray(list)
      ? list
      : Array.isArray(list?.cities)
        ? list.cities
        : [];
    if (!Array.isArray(cities)) {
      throw new Error(
        `Invalid /api/cities response: ${
          typeof list === "string" ? list : JSON.stringify(list)
        }`
      );
    }
    if (!cities.length) throw new Error("No cities returned.");
    await applyCities(cities);
    await setCachedCities(cities);
    return { fromCache: false };
  } catch (err) {
    if (cachedCities) {
      await applyCities(cachedCities);
      return { fromCache: true };
    }
    throw err;
  } finally {
    setLoading(false);
  }
}

function getActiveTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const first = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
      resolve(String(first?.url || ""));
    });
  });
}

async function syncCityFromActiveUrl() {
  if (state.syncBusy || !state.cities.length) return;
  state.syncBusy = true;
  try {
    const url = await getActiveTabUrl();
    if (!url) return;
    if (url === state.lastActiveUrl) return;
    state.lastActiveUrl = url;

    const inferred = inferCityFromUrl(url);
    if (!inferred) return;
    if (inferred === state.config.selectedCity) return;
    await setSelectedCity(inferred, { persist: true, reloadDetail: true });
  } catch (_err) {
    // URL sync failure should never block panel rendering.
  } finally {
    state.syncBusy = false;
  }
}

function bindUrlSync() {
  const trigger = () => {
    void syncCityFromActiveUrl();
  };

  chrome.tabs.onActivated.addListener(trigger);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (!tab?.active) return;
    if (changeInfo.url || changeInfo.status === "complete") {
      trigger();
    }
  });

  window.addEventListener("focus", trigger);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) trigger();
  });

  setInterval(trigger, 4000);
}

function openMainSite(view) {
  const city = encodeURIComponent(state.config.selectedCity || "");
  const siteBase = normalizeBase(state.config.siteBase || state.config.apiBase);
  const url = `${siteBase}/?city=${city}&view=${encodeURIComponent(view || "dashboard")}`;
  chrome.tabs.create({ url });
}

function bindEvents() {
  els.citySelect.addEventListener("change", async (event) => {
    const value = String(event.target.value || "");
    clearError();
    try {
      await setSelectedCity(value, { persist: true, reloadDetail: true });
    } catch (err) {
      showError(`${t("loadCityDetailFailed")}: ${err.message}`);
    }
  });

  if (els.refreshBtn) {
    els.refreshBtn.addEventListener("click", async () => {
      const city = String(state.config.selectedCity || "");
      if (!city) return;
      clearError();
      setRefreshing(true);
      try {
        await loadDetail(city, { forceRefresh: true });
      } catch (err) {
        showError(`${t("refreshFailed")}: ${err.message}`);
      } finally {
        setRefreshing(false);
      }
    });
  }

  if (els.trendCanvas) {
    els.trendCanvas.addEventListener("mousemove", onTrendCanvasHover);
    els.trendCanvas.addEventListener("mouseleave", hideChartTooltip);
  }

  els.openFullBtn.addEventListener("click", () => openMainSite("dashboard"));
  bindUrlSync();
}

async function boot() {
  bindEvents();
  applyStaticTranslations();
  clearError();
  try {
    state.config = await getConfig();
    await loadCities();
    await syncCityFromActiveUrl();
    await loadDetail(state.config.selectedCity);
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (msg.includes("HTTP 401")) {
      showError(
        `${t("initFailed")}: ${msg}\n${t("publicReadHint")}`
      );
      return;
    }
    showError(`${t("initFailed")}: ${msg}\n${t("publicModeHint")}`);
  }
}

boot();
