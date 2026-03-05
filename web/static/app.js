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
const CACHE_KEY = "polyWeather_v1";

try {
  const cachedStr = sessionStorage.getItem(CACHE_KEY);
  if (cachedStr) {
    const parsed = JSON.parse(cachedStr);
    if (Date.now() - parsed.timestamp < 5 * 60 * 1000) {
      cityDataCache = parsed.data || {};
    } else {
      sessionStorage.removeItem(CACHE_KEY);
    }
  }
} catch (e) {
  console.warn("Restore cache failed", e);
}

function saveCache() {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), data: cityDataCache }),
    );
  } catch (e) {}
}

let selectedCity = null;
let tempChart = null;
const AUTO_REFRESH_MS = 60 * 60 * 1000; // 1 hour
let selectedForecastDate = null;
let nearbyLayerGroup = null;
let heatLayer = null;

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

  nearbyLayerGroup = L.layerGroup().addTo(map);

  // Initialize Heatmap layer (requires Leaflet.heat)
  heatLayer = L.heatLayer([], {
    radius: 70,
    blur: 50,
    maxZoom: 10,
    gradient: {
      0.0: "blue",
      0.2: "cyan",
      0.4: "lime",
      0.6: "yellow",
      0.8: "orange",
      1.0: "red",
    },
    opacity: 0.5,
  }).addTo(map);

  // Close panel and clear selection when clicking on empty map space
  map.on("click", () => {
    closePanel();
  });

  // Handle zoom-based visibility for local stations and minor cities
  map.on("zoomend", updateMapVisibility);
}

function updateMapVisibility() {
  if (!map) return;
  const zoom = map.getZoom();

  // 1. Handle Nearby Individual Stations (very high zoom only)
  // These are the "Ankara-style" local station markers
  if (zoom < 7) {
    if (map.hasLayer(nearbyLayerGroup)) map.removeLayer(nearbyLayerGroup);
    if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
  } else {
    if (!map.hasLayer(nearbyLayerGroup)) map.addLayer(nearbyLayerGroup);
    if (!map.hasLayer(heatLayer)) map.addLayer(heatLayer);
  }

  // 2. Handle Primary City Markers (Major vs Minor)
  Object.values(markers).forEach(({ marker, city }) => {
    const isMajor = city.is_major !== false;
    // Hide minor cities (like Ankara/Atlanta) when zoomed way out
    if (zoom < 4 && !isMajor) {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    } else {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    }
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
  updateMapVisibility();
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

async function fetchCityDetail(cityName, force = false) {
  const urlName = cityName.replace(/\s/g, "-");
  const res = await fetch(
    `/api/city/${encodeURIComponent(urlName)}?force_refresh=${force}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// ──────────────────────────────────────────────────────────
//  Nearby Map Stations Rendering
// ──────────────────────────────────────────────────────────
function renderNearbyStations(data) {
  if (!nearbyLayerGroup) return;
  nearbyLayerGroup.clearLayers();

  if (!data.mgm_nearby || data.mgm_nearby.length === 0) {
    // Regular city zoom-in
    if (data.lat != null && data.lon != null) {
      map.flyTo([data.lat, data.lon], 10, {
        animate: true,
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
    return;
  }

  const latLngs = [];

  // Add main city coordinate so it stays in bounds
  if (data.lat != null && data.lon != null) {
    latLngs.push([data.lat, data.lon]);
  }

  data.mgm_nearby.forEach((st) => {
    // Filter out stations too far if needed, but il handles grouping nicely.
    // Skip if it is the exact same marker as main (though coordinates might slightly differ)
    const sym = data.temp_symbol || "°C";
    const iconHtml = `
      <div class="nearby-marker">
        ${st.name}: <span class="nearby-temp">${st.temp}</span><span class="nearby-unit">${sym}</span>
      </div>
    `;
    const icon = L.divIcon({
      html: iconHtml,
      className: "",
      iconSize: null,
      iconAnchor: [-5, 5],
    });

    const marker = L.marker([st.lat, st.lon], { icon }).addTo(nearbyLayerGroup);
    latLngs.push([st.lat, st.lon]);
  });

  // Update Heatmap
  if (heatLayer) {
    const heatData = nearby.map((st) => [st.lat, st.lon, st.temp || 10]);
    // Add current city center to heat data
    if (data.lat && data.lon && data.current?.temp != null) {
      heatData.push([data.lat, data.lon, data.current.temp]);
    }
    heatLayer.setLatLngs(heatData);
  }

  if (latLngs.length > 1) {
    const bounds = L.latLngBounds(latLngs);
    map.flyToBounds(bounds, {
      padding: [40, 40],
      duration: 1.5,
      easeLinearity: 0.25,
      maxZoom: 10, // Don't zoom in extremely close if bounds are tight
    });
  } else if (data.lat != null && data.lon != null) {
    map.flyTo([data.lat, data.lon], 10, {
      animate: true,
      duration: 1.5,
      easeLinearity: 0.25,
    });
  }
}

// ──────────────────────────────────────────────────────────
//  Load & Render City Detail
// ──────────────────────────────────────────────────────────
async function loadCityDetail(cityName, force = false) {
  selectedCity = cityName;
  selectedForecastDate = null; // Reset selection for new city
  setActiveCityItem(cityName);
  setSelectedMarker(cityName);

  if (!force && cityDataCache[cityName]) {
    renderPanel(cityDataCache[cityName]);
    renderNearbyStations(cityDataCache[cityName]);
    return;
  }

  showLoading(true);

  try {
    const data = await fetchCityDetail(cityName, force);
    cityDataCache[cityName] = data;
    saveCache();
    renderPanel(data);

    // Render nearby stations and zoom camera (cinematic or bounds)
    renderNearbyStations(data);

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
  // Multi-model & Forecast synchronization
  if (!selectedForecastDate) {
    selectedForecastDate = data.local_date;
  }
  renderModels(data);
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
      晴朗: "☀️",
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

  // MGM info (Ankara specific)
  if (data.mgm?.temp != null) {
    let mgmTimeStr = "";
    if (data.mgm.time) {
      if (data.mgm.time.includes(":")) {
        const match = data.mgm.time.match(/T?(\d{2}:\d{2})/);
        if (match) mgmTimeStr = ` @${match[1]}`;
      }
    }
    parts.push(
      `<span style="color:#eab308;font-weight:600;background:rgba(234, 179, 8, 0.1);padding:2px 8px;border-radius:12px;border:1px solid rgba(234, 179, 8, 0.3);">⭐ MGM 实测: ${data.mgm.temp}${sym}${mgmTimeStr}</span>`,
    );
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

  // Current hour index
  const curHour = data.local_time
    ? data.local_time.split(":")[0] + ":00"
    : null;
  const curIdx = curHour ? times.indexOf(curHour) : -1;

  // === DEB-adjusted curve ===
  // Shift the OM hourly shape so its peak matches DEB prediction
  const omMax = data.forecast?.today_high;
  const debMax = data.deb?.prediction;
  const offset = debMax != null && omMax != null ? debMax - omMax : 0;

  const debTemps = temps.map((t) =>
    t != null ? +(t + offset).toFixed(1) : null,
  );

  // Split DEB curve: past = solid, future = dashed
  const debPast = debTemps.map((t, i) =>
    curIdx >= 0 && i <= curIdx ? t : null,
  );
  const debFuture = debTemps.map((t, i) =>
    curIdx < 0 || i >= curIdx ? t : null,
  );

  // METAR observation scatter points — use full today's obs if available
  const metarPoints = new Array(times.length).fill(null);
  const metarSrc = data.metar_today_obs?.length
    ? data.metar_today_obs
    : data.trend?.recent || [];
  if (metarSrc.length > 0) {
    metarSrc.forEach((r) => {
      const parts = r.time.split(":");
      let h = parseInt(parts[0], 10);
      const m = parseInt(parts[1] || "0", 10);
      if (m >= 30) h = (h + 1) % 24;
      const hourKey = h.toString().padStart(2, "0") + ":00";
      const idx = times.indexOf(hourKey);
      if (idx >= 0 && metarPoints[idx] === null) {
        metarPoints[idx] = r.temp;
      }
    });
  }

  // MGM observation point (Ankara specific)
  const mgmPoints = new Array(times.length).fill(null);
  if (data.mgm?.temp != null && data.mgm?.time) {
    const timeMatch = data.mgm.time.match(/T?(\d{2}):(\d{2})/);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      if (m >= 30) h = (h + 1) % 24;
      const hourKey = h.toString().padStart(2, "0") + ":00";
      const idx = times.indexOf(hourKey);
      if (idx >= 0) {
        mgmPoints[idx] = data.mgm.temp;
      }
    }
  }

  const ctx = document.getElementById("tempChart").getContext("2d");
  if (tempChart) tempChart.destroy();

  // MGM Hourly Forecast (Ankara specific)
  const mgmHourlyPoints = new Array(times.length).fill(null);
  let hasMgmHourly = false;
  if (data.mgm?.hourly?.length > 0) {
    data.mgm.hourly.forEach((hData) => {
      const match = hData.time.match(/T?(\d{2}):(\d{2})/);
      if (match) {
        const hourKey = match[1] + ":00";
        const idx = times.indexOf(hourKey);
        if (idx >= 0) {
          mgmHourlyPoints[idx] = hData.temp;
          hasMgmHourly = true;
        }
      }
    });
  }

  const validDebTemps = debTemps.filter((t) => t != null);
  const validMetar = metarPoints.filter((t) => t != null);
  const validMgm = mgmPoints.filter((t) => t != null);
  const validMgmHourly = mgmHourlyPoints.filter((t) => t != null);
  const allVals = [
    ...validDebTemps,
    ...validMetar,
    ...validMgm,
    ...validMgmHourly,
  ];
  if (allVals.length === 0) {
    document.getElementById("chartLegend").textContent = "暂无数据";
    return;
  }
  const minTemp = Math.floor(Math.min(...allVals)) - 1;
  const maxTemp = Math.ceil(Math.max(...allVals)) + 1;

  // Build datasets
  const datasets = [];

  if (hasMgmHourly) {
    // If MGM is available, replace DEB curve with MGM hourly curve
    datasets.push({
      label: "MGM预报",
      data: mgmHourlyPoints,
      borderColor: "rgba(234, 179, 8, 0.8)", // Yellow
      backgroundColor: "rgba(234, 179, 8, 0.05)",
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      fill: false,
      tension: 0.3,
      spanGaps: true, // Connect gaps because MGM is every 3 hours
    });
  } else {
    // Standard DEB curves
    datasets.push({
      label: "DEB预期",
      data: debPast,
      borderColor: "rgba(52, 211, 153, 0.6)",
      backgroundColor: "rgba(52, 211, 153, 0.05)",
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 3,
      fill: true,
      tension: 0.3,
      spanGaps: false,
    });
    datasets.push({
      label: "DEB预报",
      data: debFuture,
      borderColor: "rgba(52, 211, 153, 0.35)",
      borderWidth: 1.5,
      borderDash: [5, 3],
      pointRadius: 0,
      fill: false,
      tension: 0.3,
      spanGaps: false,
    });
  }

  // Add METAR
  datasets.push({
    label: "METAR实测",
    data: metarPoints,
    borderColor: "#22d3ee",
    backgroundColor: "#22d3ee",
    borderWidth: 0,
    pointRadius: 5,
    pointHoverRadius: 7,
    pointStyle: "circle",
    fill: false,
    order: 0,
  });

  if (validMgm.length > 0) {
    datasets.push({
      label: "MGM实测",
      data: mgmPoints,
      borderColor: "#facc15",
      backgroundColor: "#facc15",
      borderWidth: 0,
      pointRadius: 7,
      pointHoverRadius: 9,
      pointStyle: "star",
      fill: false,
      showLine: false,
      order: -1, // Draw on very top
    });
  }

  // Add subtle OM reference line if DEB offset is significant, ONLY if we aren't replacing with MGM
  if (!hasMgmHourly && Math.abs(offset) > 0.3) {
    datasets.push({
      label: "OM原始",
      data: temps,
      borderColor: "rgba(99, 102, 241, 0.2)",
      borderWidth: 1,
      borderDash: [2, 4],
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    });
  }

  tempChart = new Chart(ctx, {
    type: "line",
    data: { labels: times, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.9)",
          borderColor: "rgba(52, 211, 153, 0.3)",
          borderWidth: 1,
          titleFont: { family: "Inter", size: 12 },
          bodyFont: { family: "Inter", size: 12 },
          filter: (item) => item.parsed.y != null,
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

  // DEB max line annotation (horizontal)
  if (debMax != null) {
    tempChart.options.plugins.annotation = {
      annotations: {
        debLine: {
          type: "line",
          yMin: debMax,
          yMax: debMax,
          borderColor: "#34d399",
          borderWidth: 1.5,
          borderDash: [6, 3],
          label: {
            display: true,
            content: `DEB ${debMax}${data.temp_symbol}`,
            position: "end",
            backgroundColor: "rgba(52, 211, 153, 0.15)",
            color: "#34d399",
            font: { size: 10, family: "Inter" },
          },
        },
      },
    };
    tempChart.update();
  }

  // Chart legend text
  const legend = document.getElementById("chartLegend");
  const legendParts = [];
  if (data.mgm?.temp != null) {
    legendParts.push(`MGM: ${data.mgm.temp}${data.temp_symbol}`);
  }
  if (
    !hasMgmHourly &&
    debMax != null &&
    omMax != null &&
    Math.abs(offset) > 0.3
  ) {
    const sign = offset > 0 ? "+" : "";
    legendParts.push(`DEB偏移 ${sign}${offset.toFixed(1)}° vs OM`);
  }
  if (hasMgmHourly) {
    legendParts.push(`已使用MGM高精预报替换DEB分析曲线`);
  }
  if (data.trend?.recent?.length) {
    const recentStr = [...data.trend.recent]
      .slice(0, 4)
      .reverse()
      .map((r) => `${r.temp}${data.temp_symbol}@${r.time}`)
      .join(" → ");
    legendParts.push(`METAR: ${recentStr}`);
  }
  legend.textContent = legendParts.join(" ┃ ") || "";
}

function renderProbabilities(data) {
  const container = document.getElementById("probBars");
  const targetDate = selectedForecastDate || data.local_date;

  let probs = [];
  let mu = null;

  if (targetDate === data.local_date) {
    probs = data.probabilities?.distribution || [];
    mu = data.probabilities?.mu;
  } else if (data.multi_model_daily && data.multi_model_daily[targetDate]) {
    probs = data.multi_model_daily[targetDate].probabilities || [];
    mu = data.multi_model_daily[targetDate].deb?.prediction;
  }

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
  const targetDate = selectedForecastDate || data.local_date;

  let models = {};
  let deb = null;

  if (data.multi_model_daily && data.multi_model_daily[targetDate]) {
    models = data.multi_model_daily[targetDate].models || {};
    deb = data.multi_model_daily[targetDate].deb?.prediction;
  } else {
    models = data.multi_model || {};
    deb = data.deb?.prediction;
  }

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
    const isSelected = d.date === selectedForecastDate;
    const dateLabel = isToday ? "今天" : d.date.substring(5).replace("-", "/");

    html += `
            <div class="forecast-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" 
                 onclick="switchForecastDate('${data.name}', '${d.date}')"
                 style="cursor: pointer;">
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

function switchForecastDate(cityName, dateStr) {
  if (selectedCity !== cityName) return;
  selectedForecastDate = dateStr;

  const data = cityDataCache[cityName];
  if (data) {
    renderModels(data);
    renderProbabilities(data);
    renderForecast(data);
  }
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
          saveCache();

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
//  History Chart Logic
// ──────────────────────────────────────────────────────────
let historyChartInst = null;

async function openHistoryModal() {
  if (!selectedCity) return;

  const modal = document.getElementById("historyModal");
  const title = document.getElementById("historyModalTitle");
  const statsDiv = document.getElementById("historyStats");

  modal.classList.remove("hidden");
  title.textContent = `历史准确率对账 - ${selectedCity.toUpperCase()}`;
  statsDiv.innerHTML =
    '<span style="color:var(--text-muted)">正在获取底层数据库...</span>';

  try {
    const res = await fetch(`/api/history/${encodeURIComponent(selectedCity)}`);
    const json = await res.json();
    const data = json.history || [];

    if (data.length === 0) {
      statsDiv.innerHTML =
        '<span style="color:var(--text-muted)">暂无该城市历史数据</span>';
      if (historyChartInst) historyChartInst.destroy();
      return;
    }

    // Compute stats
    let hits = 0;
    let debErrors = [];
    let muErrors = [];

    const dates = [];
    const actuals = [];
    const debs = [];
    const mus = [];
    const mgms = [];

    data.forEach((row) => {
      dates.push(row.date);
      actuals.push(row.actual);
      debs.push(row.deb);
      mus.push(row.mu);
      mgms.push(row.mgm);

      if (row.actual != null && row.deb != null) {
        debErrors.push(Math.abs(row.actual - row.deb));
        if (Math.round(row.actual) === Math.round(row.deb)) {
          hits++;
        }
      }
      if (row.actual != null && row.mu != null) {
        muErrors.push(Math.abs(row.actual - row.mu));
      }
    });

    const hitRate = debErrors.length
      ? ((hits / debErrors.length) * 100).toFixed(0)
      : 0;
    const debMae = debErrors.length
      ? (debErrors.reduce((a, b) => a + b, 0) / debErrors.length).toFixed(1)
      : "-";
    const muMae = muErrors.length
      ? (muErrors.reduce((a, b) => a + b, 0) / muErrors.length).toFixed(1)
      : "-";

    statsDiv.innerHTML = `
      <div class="h-stat-card"><span class="label">DEB 结算胜率 (WU)</span><span class="val">${hitRate}%</span></div>
      <div class="h-stat-card"><span class="label">DEB MAE</span><span class="val">${debMae}°</span></div>
      <div class="h-stat-card"><span class="label">μ (概率) MAE</span><span class="val">${muMae}°</span></div>
      <div class="h-stat-card"><span class="label">有效样本数</span><span class="val">${data.length}天</span></div>
    `;

    if (historyChartInst) historyChartInst.destroy();
    const ctx = document.getElementById("historyChart").getContext("2d");

    historyChartInst = new Chart(ctx, {
      type: "line",
      data: {
        labels: dates,
        datasets: [
          {
            label: "实测最高温",
            data: actuals,
            borderColor: "#f87171", // red
            backgroundColor: "rgba(248, 113, 113, 0.1)",
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 4,
            pointBackgroundColor: "#f87171",
            pointBorderColor: "#fff",
            zIndex: 10,
          },
          {
            label: "DEB 融合",
            data: debs,
            borderColor: "#34d399", // emerald
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [5, 4],
            tension: 0.2,
            pointRadius: 3,
          },
          {
            label: "μ (概率锚定)",
            data: mus,
            borderColor: "#a78bfa", // purple
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [2, 2],
            tension: 0.2,
            pointRadius: 3,
          },
          {
            label: "MGM 官方预报",
            data: mgms,
            borderColor: "#fb923c", // orange
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 3,
            hidden: false, // Show by default for Ankara
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: { color: "#94a3b8", font: { family: "Inter", size: 12 } },
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            titleFont: { family: "Inter" },
            bodyFont: { family: "Inter" },
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}°`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: { color: "#64748b", font: { family: "Inter", size: 10 } },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: { color: "#64748b", font: { family: "Inter", size: 10 } },
          },
        },
      },
    });
  } catch (e) {
    console.error("Failed to load history", e);
    statsDiv.innerHTML =
      '<span style="color:var(--accent-red)">获取历史信息失败</span>';
  }
}

function closeHistoryModal() {
  document.getElementById("historyModal").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", async () => {
  initMap();

  // Panel close
  document.getElementById("panelClose").addEventListener("click", closePanel);

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  // Modal Event Listeners
  const histModal = document.getElementById("historyModal");
  const guideModal = document.getElementById("guideModal");

  document
    .getElementById("btnShowHistory")
    .addEventListener("click", openHistoryModal);
  document
    .getElementById("historyModalClose")
    .addEventListener("click", closeHistoryModal);
  histModal.addEventListener("click", (e) => {
    if (e.target.id === "historyModal") closeHistoryModal();
  });

  document.getElementById("btnShowGuide").addEventListener("click", () => {
    guideModal.classList.remove("hidden");
  });
  document.getElementById("guideModalClose").addEventListener("click", () => {
    guideModal.classList.add("hidden");
  });
  guideModal.addEventListener("click", (e) => {
    if (e.target.id === "guideModal") guideModal.classList.add("hidden");
  });

  // Refresh all button
  document
    .getElementById("refreshAllBtn")
    .addEventListener("click", async () => {
      const btn = document.getElementById("refreshAllBtn");
      btn.classList.add("spinning");
      cityDataCache = {};
      saveCache();
      if (selectedCity) {
        await loadCityDetail(selectedCity, true);
      }
      btn.classList.remove("spinning");
    });

  // Load cities
  const cities = await fetchCities();
  if (cities.length > 0) {
    cities.forEach((c) => {
      const cached = cityDataCache[c.name];
      if (cached && cached.current?.temp != null) {
        c._temp =
          cached.current.max_so_far != null &&
          cached.current.max_so_far >= cached.current.temp
            ? cached.current.max_so_far
            : cached.current.temp;
      }
    });

    addCityMarkers(cities);
    buildCityList(cities);

    cities.forEach((c) => {
      if (cityDataCache[c.name]) {
        updateCityListInfo(cityDataCache[c.name]);
      }
    });

    // Fit map to show all markers
    const bounds = cities.map((c) => [c.lat, c.lon]);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 4 });

    // 启动后台渐进式预加载所有城市的温度
    loadAllCitiesProgressively(cities);
  }

  startAutoRefresh();
});
