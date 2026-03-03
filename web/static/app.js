/**
 * PolyWeather 地图 — 前端应用
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Leaflet 地图 + 详情面板 + Chart.js 温度走势
 */

// ──────────────────────────────────────────────────────────
//  State
// ──────────────────────────────────────────────────────────
let map = null;
let markers = {}; // cityName → Leaflet marker
let cityDataCache = {}; // cityName → API response
let selectedCity = null;
let tempChart = null;
const AUTO_REFRESH_MS = 60 * 60 * 1000; // 1 hour

// ──────────────────────────────────────────────────────────
//  Map Setup
// ──────────────────────────────────────────────────────────
function initMap() {
  map = L.map("map", {
    center: [30, 10],
    zoom: 3,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: false,
    attributionControl: true,
  });

  // Move zoom control to bottom right to avoid overlapping with city list
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // CartoDB Dark Matter tiles (free, dark theme)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  // Close panel and clear selection when clicking on empty map space
  map.on("click", () => {
    closePanel();
  });
}

// ──────────────────────────────────────────────────────────
//  Markers
// ──────────────────────────────────────────────────────────
function createMarkerIcon(city) {
  const riskClass = `risk-${city.risk_level}`;
  const label = city.display_name;
  // Short name for marker
  const unitSym = city.temp_unit === "fahrenheit" ? "°F" : "°C";
  const shortName = label.length > 10 ? label.substring(0, 8) + "…" : label;
  const tempText = city._temp !== undefined ? `${city._temp}${unitSym}` : "—";

  const html = `
        <div class="city-marker" data-city="${city.name}">
            <div class="marker-bubble ${riskClass}">${tempText}</div>
            <div class="marker-name">${shortName}</div>
        </div>
    `;
  return L.divIcon({
    html: html,
    className: "",
    iconSize: [60, 40],
    iconAnchor: [30, 40],
  });
}

function addCityMarkers(cities) {
  cities.forEach((city) => {
    const icon = createMarkerIcon(city);
    const marker = L.marker([city.lat, city.lon], { icon })
      .addTo(map)
      .on("click", () => loadCityDetail(city.name));

    markers[city.name] = { marker, city };
  });

  document.getElementById("cityCount").textContent = cities.length;
}

function updateMarkerTemp(cityName, temp) {
  const entry = markers[cityName];
  if (!entry) return;
  entry.city._temp = temp;
  entry.marker.setIcon(createMarkerIcon(entry.city));
}

function setSelectedMarker(cityName) {
  // Remove previous selection
  Object.values(markers).forEach(({ marker }) => {
    const el = marker.getElement();
    if (el) el.querySelector(".city-marker")?.classList.remove("selected");
  });
  // Add selection
  const entry = markers[cityName];
  if (entry) {
    const el = entry.marker.getElement();
    if (el) el.querySelector(".city-marker")?.classList.add("selected");
  }
}

// ──────────────────────────────────────────────────────────
//  City List Sidebar
// ──────────────────────────────────────────────────────────
function buildCityList(cities) {
  const container = document.getElementById("cityListItems");
  container.innerHTML = "";

  // Sort: high risk first, then medium, then low
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...cities].sort(
    (a, b) => (order[a.risk_level] ?? 3) - (order[b.risk_level] ?? 3),
  );

  sorted.forEach((city) => {
    const div = document.createElement("div");
    div.className = "city-item";
    const cityId = city.name.replace(/\s/g, "-");
    div.id = `city-item-${cityId}`;
    div.innerHTML = `
            <div class="city-item-main">
                <span class="risk-dot ${city.risk_level}"></span>
                <span class="city-name-text">${city.display_name}</span>
                <span class="city-temp" id="temp-${cityId}">—</span>
            </div>
            <div class="city-item-info">
                <span class="city-local-time" id="time-${cityId}"></span>
                <span class="city-max-info" id="max-${cityId}"></span>
            </div>
        `;
    div.addEventListener("click", () => {
      loadCityDetail(city.name);
      map.flyTo([city.lat, city.lon], 6, { duration: 1 });
    });
    container.appendChild(div);
  });
}

function setActiveCityItem(cityName) {
  document
    .querySelectorAll(".city-item")
    .forEach((el) => el.classList.remove("active"));
  const id = `city-item-${cityName.replace(/\s/g, "-")}`;
  const el = document.getElementById(id);
  if (el) {
    el.classList.add("active");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function updateCityListInfo(cityData) {
  const cityName = cityData.name;
  const cityId = cityName.replace(/\s/g, "-");
  const temp =
    cityData.current?.max_so_far != null &&
    cityData.current.max_so_far >= (cityData.current.temp || -999)
      ? cityData.current.max_so_far
      : cityData.current.temp;

  // Update Temperature
  const tempEl = document.getElementById(`temp-${cityId}`);
  if (tempEl && temp != null) {
    tempEl.textContent = `${temp}${cityData.temp_symbol}`;
    tempEl.classList.add("loaded");
  }

  // Update Local Time
  const timeEl = document.getElementById(`time-${cityId}`);
  if (timeEl && cityData.local_time) {
    timeEl.textContent = `🕐 ${cityData.local_time}`;
  }

  // Update Max Temp Time
  const maxEl = document.getElementById(`max-${cityId}`);
  if (maxEl && cityData.current?.max_temp_time) {
    maxEl.textContent = `峰值 @${cityData.current.max_temp_time}`;
  }
}

// ──────────────────────────────────────────────────────────
//  API Calls
// ──────────────────────────────────────────────────────────
async function fetchCities() {
  try {
    const res = await fetch("/api/cities");
    const data = await res.json();
    return data.cities || [];
  } catch (e) {
    console.error("Failed to fetch cities:", e);
    return [];
  }
}

async function fetchCityDetail(cityName) {
  const urlName = cityName.replace(/\s/g, "-");
  const res = await fetch(`/api/city/${encodeURIComponent(urlName)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// ──────────────────────────────────────────────────────────
//  Load & Render City Detail
// ──────────────────────────────────────────────────────────
async function loadCityDetail(cityName) {
  selectedCity = cityName;
  setActiveCityItem(cityName);
  setSelectedMarker(cityName);
  showLoading(true);

  try {
    const data = await fetchCityDetail(cityName);
    cityDataCache[cityName] = data;
    renderPanel(data);
    // Update marker and list
    if (data.current?.temp != null) {
      const displayTemp =
        data.current.max_so_far != null &&
        data.current.max_so_far >= data.current.temp
          ? data.current.max_so_far
          : data.current.temp;
      updateMarkerTemp(cityName, displayTemp);
      updateCityListInfo(data);
    }
  } catch (e) {
    console.error(`Failed to load ${cityName}:`, e);
    alert(`加载 ${cityName} 数据失败：${e.message}`);
  } finally {
    showLoading(false);
  }
}

function showLoading(show) {
  document.getElementById("loading").classList.toggle("hidden", !show);
}

// ──────────────────────────────────────────────────────────
//  Panel Rendering
// ──────────────────────────────────────────────────────────
function renderPanel(data) {
  const panel = document.getElementById("panel");
  panel.classList.remove("hidden");
  // Trigger reflow for animation
  requestAnimationFrame(() => panel.classList.add("visible"));

  // Header
  document.getElementById("panelCityName").textContent =
    `${data.risk?.emoji || "🏙️"} ${data.display_name}`;
  document.getElementById("panelLocalTime").textContent =
    `🕐 ${data.local_time || "—"} 当地时间`;

  const badge = document.getElementById("panelRiskBadge");
  badge.textContent =
    {
      high: "🔴 高危",
      medium: "🟡 中危",
      low: "🟢 低危",
    }[data.risk?.level] || "未知";
  badge.className = `risk-badge ${data.risk?.level || "low"}`;

  // Hero
  renderHero(data);
  // Chart
  renderChart(data);
  // Probabilities
  renderProbabilities(data);
  // Multi-model
  renderModels(data);
  // Forecast
  renderForecast(data);
  // AI
  renderAI(data);
  // Risk
  renderRisk(data);
}

const METAR_WX_MAP = {
  RA: { label: "降雨", icon: "🌧️" },
  "-RA": { label: "轻雨", icon: "🌦️" },
  "+RA": { label: "强降雨", icon: "⛈️" },
  SN: { label: "降雪", icon: "❄️" },
  "-SN": { label: "轻雪", icon: "🌨️" },
  "+SN": { label: "大雪", icon: "🏔️" },
  DZ: { label: "毛毛雨", icon: "🌦️" },
  FG: { label: "雾", icon: "🌫️" },
  BR: { label: "薄雾", icon: "🌫️" },
  HZ: { label: "霾", icon: "🌫️" },
  TS: { label: "雷暴", icon: "⛈️" },
  VCTS: { label: "附近雷暴", icon: "⛈️" },
  SQ: { label: "飑", icon: "💨" },
  GS: { label: "冰雹", icon: "🌨️" },
};

function translateMETAR(code) {
  if (!code) return null;
  // Handle complex codes like "-RA FG" or "TSRA"
  for (const [key, val] of Object.entries(METAR_WX_MAP)) {
    if (code.includes(key)) return val;
  }
  return { label: code, icon: "🌡️" };
}

function renderHero(data) {
  const cur = data.current || {};
  const sym = data.temp_symbol || "°C";

  const displayTemp =
    cur.max_so_far != null && cur.max_so_far >= (cur.temp || -999)
      ? cur.max_so_far
      : cur.temp;

  // Use cloud_desc or wx_desc
  let weatherText = cur.cloud_desc || "未知";
  let weatherIcon =
    {
      多云: "⛅",
      阴天: "☁️",
      少云: "🌤️",
      散云: "⛅",
      晴: "☀️",
    }[cur.cloud_desc] || "🌡️";

  // If we have a specific weather phenomenon (METAR wx_desc like -RA), prioritize it
  if (cur.wx_desc) {
    const metarTranslation = translateMETAR(cur.wx_desc);
    if (metarTranslation) {
      weatherText = metarTranslation.label;
      weatherIcon = metarTranslation.icon;
    }
  }

  document.getElementById("heroWeather").innerHTML = `
        <span>${weatherIcon} ${weatherText}</span>
    `;

  document.getElementById("heroTemp").textContent =
    displayTemp != null ? displayTemp.toFixed(1) : "—";
  document.getElementById("heroUnit").textContent = sym;

  // Show if it's the peak recorded temperature
  const isMax = cur.max_so_far != null && cur.max_so_far >= (cur.temp || -999);
  const maxTimeEl = document.getElementById("heroMaxTime");
  if (isMax && cur.max_temp_time) {
    maxTimeEl.textContent = `该城市今日最高温出现于当地时间 ${cur.max_temp_time}`;
  } else {
    maxTimeEl.textContent = "";
  }

  document.getElementById("heroCurrent").textContent =
    cur.temp != null ? `${cur.temp}${sym} @${cur.obs_time || "—"}` : "—";
  document.getElementById("heroWU").textContent =
    cur.wu_settlement != null ? `${cur.wu_settlement}${sym}` : "—";
  document.getElementById("heroDEB").textContent =
    data.deb?.prediction != null ? `${data.deb.prediction}${sym}` : "—";

  // Sub info
  const parts = [];
  if (cur.obs_time) {
    let ageStr = "";
    if (cur.obs_age_min != null && cur.obs_age_min >= 30) {
      ageStr = ` (${cur.obs_age_min}分钟前)`;
    }
    parts.push(`<span>✈️ METAR ${cur.obs_time}${ageStr}</span>`);
  }
  // Use translated wx_desc if available
  if (cur.wx_desc) {
    const trans = translateMETAR(cur.wx_desc);
    parts.push(`<span>${trans.icon} ${trans.label}</span>`);
  } else if (cur.cloud_desc) {
    // Already in hero, but keep it in sub if user wants detail
    parts.push(`<span>☁️ ${cur.cloud_desc}</span>`);
  }
  if (cur.wind_speed_kt != null) {
    parts.push(`<span>💨 ${cur.wind_speed_kt}kt</span>`);
  }
  if (cur.visibility_mi != null) {
    parts.push(`<span>👁️ ${cur.visibility_mi}mi</span>`);
  }

  // Trend badge
  const trend = data.trend || {};
  if (trend.is_dead_market) {
    parts.push('<span class="dead-market">☠️ 死盘</span>');
  } else if (trend.direction && trend.direction !== "unknown") {
    const labels = {
      rising: "📈 升温中",
      falling: "📉 降温中",
      stagnant: "⏸️ 已停滞",
      mixed: "📊 波动中",
    };
    parts.push(
      `<span class="trend-badge ${trend.direction}">${labels[trend.direction] || trend.direction}</span>`,
    );
  }

  document.getElementById("heroSub").innerHTML = parts.join("");
}

function renderChart(data) {
  const hourly = data.hourly || {};
  const times = hourly.times || [];
  const temps = hourly.temps || [];

  if (times.length === 0) {
    document.getElementById("chartLegend").textContent = "暂无小时数据";
    return;
  }

  // Find current hour index
  const curHour = data.local_time
    ? data.local_time.split(":")[0] + ":00"
    : null;
  const curIdx = curHour ? times.indexOf(curHour) : -1;

  // Forecast vs actual split
  const actualTemps = temps.map((t, i) =>
    curIdx >= 0 && i <= curIdx ? t : null,
  );
  const forecastTemps = temps.map((t, i) =>
    curIdx < 0 || i >= curIdx ? t : null,
  );

  const ctx = document.getElementById("tempChart").getContext("2d");
  if (tempChart) tempChart.destroy();

  const validTemps = temps.filter((t) => t != null);
  const minTemp = Math.floor(Math.min(...validTemps)) - 1;
  const maxTemp = Math.ceil(Math.max(...validTemps)) + 1;

  tempChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: times,
      datasets: [
        {
          label: "实测",
          data: actualTemps,
          borderColor: "#22d3ee",
          backgroundColor: "rgba(34, 211, 238, 0.1)",
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.3,
          spanGaps: false,
        },
        {
          label: "预报",
          data: forecastTemps,
          borderColor: "rgba(99, 102, 241, 0.6)",
          borderWidth: 1.5,
          borderDash: [5, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.3,
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.9)",
          borderColor: "rgba(99, 102, 241, 0.3)",
          borderWidth: 1,
          titleFont: { family: "Inter", size: 12 },
          bodyFont: { family: "Inter", size: 12 },
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}${data.temp_symbol}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: {
            color: "#64748b",
            font: { size: 10, family: "Inter" },
            maxRotation: 0,
            callback: (val, idx) => (idx % 3 === 0 ? times[idx] : ""),
          },
        },
        y: {
          min: minTemp,
          max: maxTemp,
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: {
            color: "#64748b",
            font: { size: 10, family: "Inter" },
            callback: (v) => v + (data.temp_symbol || "°"),
          },
        },
      },
    },
  });

  // DEB prediction line annotation
  if (data.deb?.prediction != null) {
    const debY = data.deb.prediction;
    tempChart.options.plugins.annotation = {
      annotations: {
        debLine: {
          type: "line",
          yMin: debY,
          yMax: debY,
          borderColor: "#34d399",
          borderWidth: 1,
          borderDash: [4, 4],
        },
      },
    };
    tempChart.update();
  }

  // METAR recent points overlay
  const legend = document.getElementById("chartLegend");
  if (data.trend?.recent?.length) {
    const recentStr = [...data.trend.recent]
      .slice(0, 4)
      .reverse() // Fix chronologically left to right
      .map((r) => `${r.temp}${data.temp_symbol}@${r.time}`)
      .join(" → ");
    legend.textContent = `METAR 趋势：${recentStr}`;
  } else {
    legend.textContent = "";
  }
}

function renderProbabilities(data) {
  const container = document.getElementById("probBars");
  const probs = data.probabilities?.distribution || [];
  const mu = data.probabilities?.mu;

  if (probs.length === 0) {
    container.innerHTML =
      '<div style="color:var(--text-muted);font-size:13px;">暂无概率数据</div>';
    return;
  }

  let html = "";
  if (mu != null) {
    html += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">期望值 μ = ${mu}${data.temp_symbol}</div>`;
  }

  probs.forEach((p, i) => {
    const pct = Math.round(p.probability * 100);
    const width = Math.max(pct, 8);
    html += `
            <div class="prob-row">
                <div class="prob-label">${p.value}${data.temp_symbol}</div>
                <div class="prob-bar-track">
                    <div class="prob-bar-fill rank-${i}" style="width:0%">${pct}%</div>
                </div>
            </div>
        `;
  });
  container.innerHTML = html;

  // Animate bars
  requestAnimationFrame(() => {
    container.querySelectorAll(".prob-bar-fill").forEach((bar, i) => {
      const pct = Math.round(probs[i].probability * 100);
      bar.style.width = Math.max(pct, 8) + "%";
    });
  });
}

function renderModels(data) {
  const container = document.getElementById("modelBars");
  const models = data.multi_model || {};
  const deb = data.deb?.prediction;

  if (Object.keys(models).length === 0) {
    container.innerHTML =
      '<div style="color:var(--text-muted);font-size:13px;">暂无多模型数据</div>';
    return;
  }

  const values = Object.values(models).filter((v) => v != null);
  const minVal = Math.min(...values) - 1;
  const maxVal = Math.max(...values) + 1;
  const range = maxVal - minVal;

  let html = "";
  const sorted = Object.entries(models).sort(
    (a, b) => (b[1] || 0) - (a[1] || 0),
  );

  sorted.forEach(([name, val]) => {
    if (val == null) return;
    const pct = ((val - minVal) / range) * 100;
    const shortName = name.length > 10 ? name.substring(0, 9) + "…" : name;
    html += `
            <div class="model-row">
                <div class="model-name" title="${name}">${shortName}</div>
                <div class="model-bar-track">
                    <div class="model-bar-fill" style="width:${pct}%">${val}${data.temp_symbol}</div>
                    ${deb != null ? `<div class="model-deb-line" style="left:${((deb - minVal) / range) * 100}%"></div>` : ""}
                </div>
            </div>
        `;
  });

  // DEB row
  if (deb != null) {
    const pct = ((deb - minVal) / range) * 100;
    html += `
            <div class="model-row" style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">
                <div class="model-name" style="color:var(--accent-cyan);font-weight:700;">DEB</div>
                <div class="model-bar-track">
                    <div class="model-bar-fill deb" style="width:${pct}%">${deb}${data.temp_symbol}</div>
                </div>
            </div>
        `;
  }

  container.innerHTML = html;
}

function renderForecast(data) {
  const container = document.getElementById("forecastTable");
  const daily = data.forecast?.daily || [];
  const sym = data.temp_symbol || "°C";

  if (daily.length === 0) {
    container.innerHTML =
      '<div style="color:var(--text-muted);font-size:13px;">暂无预报</div>';
    return;
  }

  let html = "";
  daily.forEach((d, i) => {
    const isToday = i === 0;
    const dateLabel = isToday ? "今天" : d.date.substring(5);
    html += `
            <div class="forecast-day ${isToday ? "today" : ""}">
                <div class="f-date">${dateLabel}</div>
                <div class="f-temp">${d.max_temp}${sym}</div>
            </div>
        `;
  });
  container.innerHTML = html;

  // Sun info
  const sunEl = document.getElementById("sunInfo");
  const parts = [];
  if (data.forecast?.sunrise) parts.push(`🌅 ${data.forecast.sunrise}`);
  if (data.forecast?.sunset) parts.push(`🌇 ${data.forecast.sunset}`);
  if (data.forecast?.sunshine_hours)
    parts.push(`☀️ ${data.forecast.sunshine_hours}h`);
  sunEl.innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
}

function renderAI(data) {
  const container = document.getElementById("aiAnalysis");
  const text = data.ai_analysis || "";

  if (!text) {
    container.innerHTML = '<span class="ai-placeholder">AI 分析暂不可用</span>';
    return;
  }

  // The AI output may contain HTML tags like <b>
  container.innerHTML = text;
}

function renderRisk(data) {
  const container = document.getElementById("riskInfo");
  const risk = data.risk || {};

  if (!risk.airport) {
    container.innerHTML =
      '<span style="color:var(--text-muted)">无风险档案</span>';
    return;
  }

  container.innerHTML = `
        <div class="risk-row"><span class="risk-label">📍 机场</span><span>${risk.airport} (${risk.icao})</span></div>
        <div class="risk-row"><span class="risk-label">📏 距离</span><span>${risk.distance_km}km</span></div>
        ${risk.warning ? `<div class="risk-row"><span class="risk-label">⚠️ 注意</span><span>${risk.warning}</span></div>` : ""}
    `;
}

// ──────────────────────────────────────────────────────────
//  Panel Controls
// ──────────────────────────────────────────────────────────
function closePanel() {
  const panel = document.getElementById("panel");
  panel.classList.remove("visible");
  setTimeout(() => panel.classList.add("hidden"), 400);
  selectedCity = null;
  setSelectedMarker(null);
  document
    .querySelectorAll(".city-item")
    .forEach((el) => el.classList.remove("active"));
}

// ──────────────────────────────────────────────────────────
//  Auto-Refresh
// ──────────────────────────────────────────────────────────
function startAutoRefresh() {
  setInterval(async () => {
    if (selectedCity) {
      // Invalidate cache
      delete cityDataCache[selectedCity];
      try {
        const data = await fetchCityDetail(selectedCity);
        cityDataCache[selectedCity] = data;
        renderPanel(data);
        if (data.current?.temp != null) {
          const displayTemp =
            data.current.max_so_far != null &&
            data.current.max_so_far >= data.current.temp
              ? data.current.max_so_far
              : data.current.temp;
          updateMarkerTemp(selectedCity, displayTemp);
          updateCityListInfo(data);
        }
        flashLiveBadge();
      } catch (e) {
        console.warn("Auto-refresh failed:", e);
      }
    }
  }, AUTO_REFRESH_MS);
}

function flashLiveBadge() {
  const badge = document.getElementById("liveBadge");
  badge.style.transform = "scale(1.1)";
  setTimeout(() => {
    badge.style.transform = "scale(1)";
  }, 300);
}

// ──────────────────────────────────────────────────────────
//  Background Progressive Loading
// ──────────────────────────────────────────────────────────
async function loadAllCitiesProgressively(cities) {
  // 延迟 1 秒后开始后台加载，避免阻塞初始渲染
  await new Promise((r) => setTimeout(r, 1000));

  for (const city of cities) {
    // Skip if already clicked/loaded or selected
    if (!cityDataCache[city.name]) {
      try {
        const urlName = city.name.replace(/\s/g, "-");
        const res = await fetch(`/api/city/${encodeURIComponent(urlName)}`);
        if (res.ok) {
          const data = await res.json();
          cityDataCache[city.name] = data;

          // 如果用户目前没有点击它，仅更新标记和列表
          if (data.current?.temp != null) {
            const displayTemp =
              data.current.max_so_far != null &&
              data.current.max_so_far >= data.current.temp
                ? data.current.max_so_far
                : data.current.temp;
            updateMarkerTemp(city.name, displayTemp);
            updateCityListInfo(data);
          }

          // 如果恰好在这个时候用户选中了这个城市，顺便刷新面板
          if (selectedCity === city.name) {
            renderPanel(data);
          }
        }
      } catch (e) {
        console.warn(`Background load failed for ${city.name}`, e);
      }
      // 间隔 2000ms，避免瞬间并发轰炸后端 API，且让出浏览器主线程
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ──────────────────────────────────────────────────────────
//  Init
// ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  initMap();

  // Panel close
  document.getElementById("panelClose").addEventListener("click", closePanel);

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  // Refresh all button
  document
    .getElementById("refreshAllBtn")
    .addEventListener("click", async () => {
      const btn = document.getElementById("refreshAllBtn");
      btn.classList.add("spinning");
      cityDataCache = {};
      if (selectedCity) {
        await loadCityDetail(selectedCity);
      }
      btn.classList.remove("spinning");
    });

  // Load cities
  const cities = await fetchCities();
  if (cities.length > 0) {
    addCityMarkers(cities);
    buildCityList(cities);

    // Fit map to show all markers
    const bounds = cities.map((c) => [c.lat, c.lon]);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 4 });

    // 启动后台渐进式预加载所有城市的温度
    loadAllCitiesProgressively(cities);
  }

  startAutoRefresh();
});
