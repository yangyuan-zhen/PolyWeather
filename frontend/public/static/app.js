/**
 * PolyWeather legacy dashboard client
 * Leaflet map + detail panel + Chart.js charts
 */

// ------------------------------------------------------------
// State
// ------------------------------------------------------------
let map = null;
let markers = {}; // cityName -> Leaflet marker
let cityDataCache = {}; // cityName -> API response
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
let futureForecastChart = null;
const AUTO_REFRESH_MS = 60 * 60 * 1000; // 1 hour
let selectedForecastDate = null;
let nearbyLayerGroup = null;
let autoNearbyCity = null;
let autoNearbyLoading = false;
const AUTO_NEARBY_MIN_ZOOM = 8;
const AUTO_NEARBY_MAX_DISTANCE_M = 120000;

// ------------------------------------------------------------
// Map setup
// ------------------------------------------------------------
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

  // Close panel and clear selection when clicking on empty map space
  map.on("click", () => {
    closePanel();
  });

  // Handle zoom-based visibility for local stations and minor cities
  map.on("zoomend", updateMapVisibility);
  map.on("moveend", maybeAutoShowNearbyStations);
}

function updateMapVisibility() {
  if (!map) return;
  const zoom = map.getZoom();

  // 1. Handle Nearby Individual Stations (very high zoom only)
  // These are the "Ankara-style" local station markers
  if (zoom < 7) {
    if (map.hasLayer(nearbyLayerGroup)) map.removeLayer(nearbyLayerGroup);
  } else {
    if (!map.hasLayer(nearbyLayerGroup)) map.addLayer(nearbyLayerGroup);
  }

  // 2. Keep all primary city markers visible at all zoom levels.
  // This avoids cities like Ankara disappearing when zoomed out.
  Object.values(markers).forEach(({ marker }) => {
    if (!map.hasLayer(marker)) map.addLayer(marker);
  });

  maybeAutoShowNearbyStations();
}

function getNearestCityForCenter() {
  if (!map) return null;
  const center = map.getCenter();
  let best = null;

  Object.entries(markers).forEach(([cityName, entry]) => {
    const city = entry.city;
    if (city?.lat == null || city?.lon == null) return;
    const distance = map.distance(center, L.latLng(city.lat, city.lon));
    if (distance > AUTO_NEARBY_MAX_DISTANCE_M) return;
    if (!best || distance < best.distance) {
      best = { cityName, distance };
    }
  });

  return best?.cityName || null;
}

async function maybeAutoShowNearbyStations() {
  if (!map || !nearbyLayerGroup) return;
  if (map.getZoom() < AUTO_NEARBY_MIN_ZOOM) {
    autoNearbyCity = null;
    nearbyLayerGroup.clearLayers();
    return;
  }

  const targetCity = getNearestCityForCenter();
  if (!targetCity) {
    autoNearbyCity = null;
    nearbyLayerGroup.clearLayers();
    return;
  }

  if (
    autoNearbyCity === targetCity &&
    nearbyLayerGroup.getLayers().length > 0
  ) {
    return;
  }

  autoNearbyCity = targetCity;

  if (cityDataCache[targetCity]) {
    renderNearbyStations(cityDataCache[targetCity], true);
    return;
  }

  if (autoNearbyLoading) return;
  autoNearbyLoading = true;
  try {
    const data = await fetchCityDetail(targetCity, false);
    cityDataCache[targetCity] = data;
    saveCache();
    renderNearbyStations(data, true);
    if (data.current?.temp != null) {
      updateMarkerTemp(targetCity, data.current.temp);
      updateCityListInfo(data);
    }
  } catch (e) {
    console.error(`Auto nearby load failed for ${targetCity}:`, e);
  } finally {
    autoNearbyLoading = false;
  }
}

// ------------------------------------------------------------
//  Markers
// ------------------------------------------------------------
function createMarkerIcon(city) {
  const riskClass = `risk-${city.risk_level}`;
  const label = city.display_name;
  const unitSym = city.temp_unit === "fahrenheit" ? "°F" : "°C";
  const shortName = label.length > 10 ? `${label.substring(0, 8)}…` : label;
  const tempText = city._temp !== undefined ? `${city._temp}${unitSym}` : "--";

  const html = `
        <div class="city-marker" data-city="${city.name}">
            <div class="marker-bubble ${riskClass}">${tempText}</div>
            <div class="marker-name">${shortName}</div>
        </div>
    `;
  return L.divIcon({
    html,
    className: "",
    iconSize: [80, 44],
    iconAnchor: [40, 22],
  });
}

function addCityMarkers(cities) {
  cities.forEach((city) => {
    const icon = createMarkerIcon(city);
    const marker = L.marker([city.lat, city.lon], { icon })
      .addTo(map)
      .on("click", () => {
        focusCityMarker(city);
        loadCityDetail(city.name);
      });

    markers[city.name] = { marker, city };
  });

  document.getElementById("cityCount").textContent = cities.length;
  updateMapVisibility();
}

function focusCityMarker(city) {
  if (city?.lat == null || city?.lon == null) return;
  map.flyTo([city.lat, city.lon], 6, {
    animate: true,
    duration: 1.05,
    easeLinearity: 0.2,
  });
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

// ------------------------------------------------------------
//  City List Sidebar
// ------------------------------------------------------------
function buildCityList(cities) {
  const container = document.getElementById("cityListItems");
  if (!container) return;

  container.innerHTML = "";
  const countEl = document.getElementById("cityCount");
  if (countEl) countEl.textContent = String(cities.length);

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
        <span class="city-temp" id="temp-${cityId}">--</span>
      </div>
      <div class="city-item-info">
        <span class="city-local-time" id="time-${cityId}"></span>
        <span class="city-max-info" id="max-${cityId}"></span>
      </div>
    `;
    div.addEventListener("click", () => {
      focusCityMarker(city);
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
  const temp = cityData.current?.temp;

  const tempEl = document.getElementById(`temp-${cityId}`);
  if (tempEl) {
    tempEl.textContent =
      temp != null ? `${temp}${cityData.temp_symbol || "\u00B0C"}` : "--";
    if (temp != null) tempEl.classList.add("loaded");
  }

  const timeEl = document.getElementById(`time-${cityId}`);
  if (timeEl && cityData.local_time) {
    timeEl.textContent = `\u23f0 ${cityData.local_time}`;
  }

  const maxEl = document.getElementById(`max-${cityId}`);
  if (maxEl && cityData.current?.max_temp_time) {
    maxEl.textContent = `\u5cf0\u503c @${cityData.current.max_temp_time}`;
  }
}

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

function pickAnkaraNearbyStations(allNearby) {
  const preferredNames = [
    "Airport (MGM/17128)",
    "Ankara (B\u00f6lge/Center)",
    "Ankara (Bolge/Center)",
    "Etimesgut",
    "Pursaklar",
    "Cubuk",
    "\u00c7ubuk",
    "Kalecik",
  ];

  const picks = preferredNames
    .map((name) => allNearby.find((st) => st?.name === name))
    .filter(Boolean);

  return picks.length ? picks : allNearby;
}

function renderNearbyStations(data, preserveView = false) {
  if (!nearbyLayerGroup) return;
  nearbyLayerGroup.clearLayers();

  const allNearby = Array.isArray(data.mgm_nearby) ? data.mgm_nearby : [];
  const isAnkara = String(data.name || "").toLowerCase() === "ankara";
  const nearbyStations = isAnkara
    ? pickAnkaraNearbyStations(allNearby)
    : allNearby;

  if (!nearbyStations.length) {
    if (!preserveView && data.lat != null && data.lon != null) {
      map.flyTo([data.lat, data.lon], 10, {
        animate: true,
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
    return;
  }

  const latLngs = [];
  if (data.lat != null && data.lon != null) {
    latLngs.push([data.lat, data.lon]);
  }

  nearbyStations.forEach((st) => {
    const sym = data.temp_symbol || "\u00b0C";
    let windHtml = "";
    if (st.wind_dir != null) {
      const rot = (parseFloat(st.wind_dir) + 180) % 360;
      const speedRaw = parseFloat(st.wind_speed ?? st.wind_speed_kt);
      const speed = !Number.isNaN(speedRaw)
        ? `${speedRaw.toFixed(1)}k`
        : "";
      windHtml = `
        <div class="wind-info">
          <span class="wind-arrow" style="transform: rotate(${rot}deg)">&#8599;</span>
          <span class="wind-speed">${speed}</span>
        </div>
      `;
    }

    const iconHtml = `
      <div class="nearby-marker">
        <span class="nearby-name">${st.name}</span>
        <span class="nearby-temp">${st.temp}</span><span class="nearby-unit">${sym}</span>
        ${windHtml}
      </div>
    `;

    const icon = L.divIcon({
      html: iconHtml,
      className: "",
      iconSize: null,
      iconAnchor: [0, 0],
    });

    L.marker([st.lat, st.lon], { icon }).addTo(nearbyLayerGroup);
    latLngs.push([st.lat, st.lon]);
  });

  if (preserveView) return;

  if (latLngs.length > 1) {
    map.flyToBounds(L.latLngBounds(latLngs), {
      padding: [40, 40],
      duration: 1.5,
      easeLinearity: 0.25,
      maxZoom: 10,
    });
  } else if (data.lat != null && data.lon != null) {
    map.flyTo([data.lat, data.lon], 10, {
      animate: true,
      duration: 1.5,
      easeLinearity: 0.25,
    });
  }
}

async function loadCityDetail(cityName, force = false) {
  selectedCity = cityName;
  selectedForecastDate = null;
  setActiveCityItem(cityName);
  setSelectedMarker(cityName);

  if (!force && cityDataCache[cityName]) {
    const cachedData = cityDataCache[cityName];
    renderPanel(cachedData);
    renderNearbyStations(cachedData);
    return;
  }

  showLoading(true);

  try {
    const data = await fetchCityDetail(cityName, force);
    cityDataCache[cityName] = data;
    saveCache();
    renderPanel(data);
    renderNearbyStations(data);

    if (data.current?.temp != null) {
      updateMarkerTemp(cityName, data.current.temp);
      updateCityListInfo(data);
    }
  } catch (e) {
    console.error(`Failed to load ${cityName}:`, e);
    alert(`\u52a0\u8f7d ${cityName} \u6570\u636e\u5931\u8d25\uff1a${e.message}`);
  } finally {
    showLoading(false);
  }
}

function showLoading(show) {
  const loading = document.getElementById("loading");
  if (loading) loading.classList.toggle("hidden", !show);
}

const METAR_WX_MAP = {
  RA: { label: "\u964d\u96e8", icon: "\ud83c\udf27\ufe0f" },
  "-RA": { label: "\u5c0f\u96e8", icon: "\ud83c\udf26\ufe0f" },
  "+RA": { label: "\u5f3a\u964d\u96e8", icon: "\u26c8\ufe0f" },
  SN: { label: "\u964d\u96ea", icon: "\u2744\ufe0f" },
  "-SN": { label: "\u5c0f\u96ea", icon: "\ud83c\udf28\ufe0f" },
  "+SN": { label: "\u5927\u96ea", icon: "\ud83c\udf28\ufe0f" },
  DZ: { label: "\u6bdb\u6bdb\u96e8", icon: "\ud83c\udf26\ufe0f" },
  FG: { label: "\u96fe", icon: "\ud83c\udf2b\ufe0f" },
  BR: { label: "\u8584\u96fe", icon: "\ud83c\udf2b\ufe0f" },
  HZ: { label: "\u973e", icon: "\ud83c\udf2b\ufe0f" },
  TS: { label: "\u96f7\u66b4", icon: "\u26c8\ufe0f" },
  VCTS: { label: "\u9644\u8fd1\u96f7\u66b4", icon: "\u26c8\ufe0f" },
  SQ: { label: "\u98d1", icon: "\ud83d\udca8" },
  GS: { label: "\u51b0\u96f9", icon: "\ud83c\udf28\ufe0f" },
};

function translateMETAR(code) {
  if (!code) return null;
  for (const [key, val] of Object.entries(METAR_WX_MAP)) {
    if (String(code).includes(key)) return val;
  }
  return { label: code, icon: "\ud83c\udf24\ufe0f" };
}

function renderPanel(data) {
  const panel = document.getElementById("panel");
  if (!panel) return;

  panel.classList.remove("hidden");
  requestAnimationFrame(() => panel.classList.add("visible"));

  const panelCityName = document.getElementById("panelCityName");
  const panelLocalTime = document.getElementById("panelLocalTime");
  const badge = document.getElementById("panelRiskBadge");

  if (panelCityName) {
    panelCityName.textContent = `${data.risk?.emoji || "\ud83c\udfd9\ufe0f"} ${data.display_name}`;
  }
  if (panelLocalTime) {
    panelLocalTime.textContent = `\u23f0 ${data.local_time || "--:--"} \u5f53\u5730\u65f6\u95f4`;
  }
  if (badge) {
    badge.textContent =
      {
        high: "\ud83d\udd34 \u9ad8\u5371",
        medium: "\ud83d\udfe1 \u4e2d\u5371",
        low: "\ud83d\udfe2 \u4f4e\u5371",
      }[data.risk?.level] || "\u672a\u77e5";
    badge.className = `risk-badge ${data.risk?.level || "low"}`;
  }

  renderHero(data);
  renderChart(data);
  if (!selectedForecastDate) selectedForecastDate = data.local_date;
  renderProbabilities(data);
  renderModels(data);
  renderForecast(data);
  renderAI(data);
  renderRisk(data);
}

function renderHero(data) {
  const cur = data.current || {};
  const sym = data.temp_symbol || "\u00b0C";
  const displayTemp = cur.temp;

  let weatherText = cur.cloud_desc || "\u672a\u77e5";
  let weatherIcon =
    {
      "\u591a\u4e91": "\u2601\ufe0f",
      "\u9634\u5929": "\u2601\ufe0f",
      "\u5c11\u4e91": "\ud83c\udf24\ufe0f",
      "\u6563\u4e91": "\u2601\ufe0f",
      "\u6674": "\u2600\ufe0f",
      "\u6674\u6717": "\u2600\ufe0f",
    }[cur.cloud_desc] || "\ud83c\udf24\ufe0f";

  if (cur.wx_desc) {
    const translated = translateMETAR(cur.wx_desc);
    if (translated) {
      weatherText = translated.label;
      weatherIcon = translated.icon;
    }
  }

  const heroWeather = document.getElementById("heroWeather");
  const heroTemp = document.getElementById("heroTemp");
  const heroUnit = document.getElementById("heroUnit");
  const maxTimeEl = document.getElementById("heroMaxTime");
  const heroCurrent = document.getElementById("heroCurrent");
  const heroWU = document.getElementById("heroWU");
  const heroDEB = document.getElementById("heroDEB");
  const heroSub = document.getElementById("heroSub");

  if (heroWeather) heroWeather.innerHTML = `<span>${weatherIcon} ${weatherText}</span>`;
  if (heroTemp) heroTemp.textContent = displayTemp != null ? displayTemp.toFixed(1) : "--";
  if (heroUnit) heroUnit.textContent = sym;

  const isMax = cur.max_so_far != null && cur.temp != null && cur.max_so_far <= cur.temp;
  if (maxTimeEl) {
    maxTimeEl.textContent =
      isMax && cur.max_temp_time
        ? `\u8be5\u57ce\u5e02\u4eca\u65e5\u6700\u9ad8\u6e29\u51fa\u73b0\u4e8e\u5f53\u5730\u65f6\u95f4 ${cur.max_temp_time}`
        : "";
  }

  if (heroCurrent) {
    heroCurrent.textContent =
      cur.temp != null ? `${cur.temp}${sym} @${cur.obs_time || "--:--"}` : "--";
  }
  if (heroWU) {
    heroWU.textContent = cur.wu_settlement != null ? `${cur.wu_settlement}${sym}` : "--";
  }
  if (heroDEB) {
    heroDEB.textContent =
      data.deb?.prediction != null ? `${data.deb.prediction}${sym}` : "--";
  }

  const parts = [];
  if (cur.obs_time) {
    const ageStr =
      cur.obs_age_min != null && cur.obs_age_min >= 30
        ? ` (${cur.obs_age_min}\u5206\u949f\u524d)`
        : "";
    parts.push(`<span>\u2708\ufe0f METAR ${cur.obs_time}${ageStr}</span>`);
  }
  if (cur.wx_desc) {
    const trans = translateMETAR(cur.wx_desc);
    parts.push(`<span>${trans.icon} ${trans.label}</span>`);
  } else if (cur.cloud_desc) {
    parts.push(`<span>\u2601\ufe0f ${cur.cloud_desc}</span>`);
  }
  if (cur.wind_speed_kt != null) {
    parts.push(`<span>\ud83d\udca8 ${cur.wind_speed_kt}kt</span>`);
  }
  if (cur.visibility_mi != null) {
    parts.push(`<span>\ud83d\udc41\ufe0f ${cur.visibility_mi}mi</span>`);
  }
  if (data.mgm?.temp != null) {
    let mgmTimeStr = "";
    if (data.mgm.time && data.mgm.time.includes(":")) {
      const match = data.mgm.time.match(/T?(\d{2}:\d{2})/);
      if (match) mgmTimeStr = ` @${match[1]}`;
    }
    parts.push(
      `<span style="color:#eab308;font-weight:600;background:rgba(234, 179, 8, 0.1);padding:2px 8px;border-radius:12px;border:1px solid rgba(234, 179, 8, 0.3);">\u2b50 MGM \u5b9e\u6d4b: ${data.mgm.temp}${sym}${mgmTimeStr}</span>`,
    );
  }

  const trend = data.trend || {};
  if (trend.is_dead_market) {
    parts.push('<span class="dead-market">\u2620\ufe0f \u6b7b\u76d8</span>');
  } else if (trend.direction && trend.direction !== "unknown") {
    const labels = {
      rising: "\ud83d\udcc8 \u5347\u6e29\u4e2d",
      falling: "\ud83d\udcc9 \u964d\u6e29\u4e2d",
      stagnant: "\u23f8 \u5df2\u505c\u6ede",
      mixed: "\ud83d\udcca \u6ce2\u52a8\u4e2d",
    };
    parts.push(
      `<span class="trend-badge ${trend.direction}">${labels[trend.direction] || trend.direction}</span>`,
    );
  }

  if (heroSub) heroSub.innerHTML = parts.join("");
}

function renderChart(data) {
  const hourly = data.hourly || {};
  const times = hourly.times || [];
  const temps = hourly.temps || [];
  const chartLegend = document.getElementById("chartLegend");

  if (!times.length) {
    if (chartLegend) chartLegend.textContent = "\u6682\u65e0\u5c0f\u65f6\u6570\u636e";
    return;
  }

  const curHour = data.local_time ? `${data.local_time.split(":")[0]}:00` : null;
  const curIdx = curHour ? times.indexOf(curHour) : -1;
  const omMax = data.forecast?.today_high;
  const debMax = data.deb?.prediction;
  const offset = debMax != null && omMax != null ? debMax - omMax : 0;
  const debTemps = temps.map((t) => (t != null ? +(t + offset).toFixed(1) : null));
  const debPast = debTemps.map((t, i) => (curIdx >= 0 && i <= curIdx ? t : null));
  const debFuture = debTemps.map((t, i) => (curIdx < 0 || i >= curIdx ? t : null));

  const metarPoints = new Array(times.length).fill(null);
  const metarSrc = data.metar_today_obs?.length
    ? data.metar_today_obs
    : data.trend?.recent || [];
  metarSrc.forEach((r) => {
    const parts = String(r.time || "").split(":");
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1] || "0", 10);
    if (Number.isNaN(h)) return;
    if (m >= 30) h = (h + 1) % 24;
    const hourKey = `${String(h).padStart(2, "0")}:00`;
    const idx = times.indexOf(hourKey);
    if (idx >= 0 && metarPoints[idx] === null) metarPoints[idx] = r.temp;
  });

  const mgmPoints = new Array(times.length).fill(null);
  if (data.mgm?.temp != null && data.mgm?.time) {
    const timeMatch = data.mgm.time.match(/T?(\d{2}):(\d{2})/);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      if (m >= 30) h = (h + 1) % 24;
      const hourKey = `${String(h).padStart(2, "0")}:00`;
      const idx = times.indexOf(hourKey);
      if (idx >= 0) mgmPoints[idx] = data.mgm.temp;
    }
  }

  const ctxEl = document.getElementById("tempChart");
  if (!ctxEl) return;
  const ctx = ctxEl.getContext("2d");
  if (tempChart) tempChart.destroy();

  const mgmHourlyPoints = new Array(times.length).fill(null);
  let hasMgmHourly = false;
  if (Array.isArray(data.mgm?.hourly)) {
    data.mgm.hourly.forEach((hData) => {
      const match = String(hData.time || "").match(/T?(\d{2}):(\d{2})/);
      if (!match) return;
      const hourKey = `${match[1]}:00`;
      const idx = times.indexOf(hourKey);
      if (idx >= 0) {
        mgmHourlyPoints[idx] = hData.temp;
        hasMgmHourly = true;
      }
    });
  }

  const allVals = [
    ...debTemps.filter((t) => t != null),
    ...metarPoints.filter((t) => t != null),
    ...mgmPoints.filter((t) => t != null),
    ...mgmHourlyPoints.filter((t) => t != null),
  ];

  if (!allVals.length) {
    if (chartLegend) chartLegend.textContent = "\u6682\u65e0\u56fe\u8868\u6570\u636e";
    return;
  }

  const minTemp = Math.floor(Math.min(...allVals)) - 1;
  const maxTemp = Math.ceil(Math.max(...allVals)) + 1;
  const datasets = [];

  if (hasMgmHourly) {
    datasets.push({
      label: "MGM\u9884\u62a5",
      data: mgmHourlyPoints,
      borderColor: "rgba(234, 179, 8, 0.8)",
      backgroundColor: "rgba(234, 179, 8, 0.05)",
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      fill: false,
      tension: 0.3,
      spanGaps: true,
    });
  } else {
    datasets.push({
      label: "DEB\u9884\u671f",
      data: debPast,
      borderColor: "rgba(52, 211, 153, 0.6)",
      backgroundColor: "rgba(52, 211, 153, 0.05)",
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 3,
      fill: true,
      tension: 0.3,
      spanGaps: false,
      skipTooltip: true,
    });
    datasets.push({
      label: "DEB\u9884\u62a5",
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

  datasets.push({
    label: "METAR\u5b9e\u6d4b",
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

  if (mgmPoints.some((t) => t != null)) {
    datasets.push({
      label: "MGM\u5b9e\u6d4b",
      data: mgmPoints,
      borderColor: "#facc15",
      backgroundColor: "#facc15",
      borderWidth: 0,
      pointRadius: 7,
      pointHoverRadius: 9,
      pointStyle: "star",
      fill: false,
      showLine: false,
      order: -1,
    });
  }

  if (!hasMgmHourly && Math.abs(offset) > 0.3) {
    datasets.push({
      label: "OM\u539f\u59cb",
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
          filter: (item) => item.parsed.y != null && !item.dataset.skipTooltip,
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}${data.temp_symbol || "\u00B0C"}`,
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
            callback: (v) => `${v}${data.temp_symbol || "\u00B0C"}`,
          },
        },
      },
    },
  });

  const legendParts = [];
  if (data.mgm?.temp != null)
    legendParts.push(`MGM: ${data.mgm.temp}${data.temp_symbol || "\u00B0C"}`);
  if (!hasMgmHourly && debMax != null && omMax != null && Math.abs(offset) > 0.3) {
    const sign = offset > 0 ? "+" : "";
    legendParts.push(`DEB\u504f\u79fb ${sign}${offset.toFixed(1)}\u00b0 vs OM`);
  }
  if (hasMgmHourly) legendParts.push("\u5df2\u4f7f\u7528 MGM \u5c0f\u65f6\u9884\u62a5\u66ff\u4ee3 DEB \u66f2\u7ebf");
  if (data.trend?.recent?.length) {
    const recentStr = [...data.trend.recent]
      .slice(0, 4)
      .reverse()
      .map((r) => `${r.temp}${data.temp_symbol || "\u00B0C"}@${r.time}`)
      .join(" \u2192 ");
    legendParts.push(`METAR: ${recentStr}`);
  }
  if (chartLegend) chartLegend.textContent = legendParts.join(" | ") || "";
}

function renderProbabilities(data) {
  const container = document.getElementById("probBars");
  if (!container) return;

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

  if (!probs.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">\u6682\u65e0\u6982\u7387\u6570\u636e</div>';
    return;
  }

  let html = "";
  if (mu != null) {
    html += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">\u52a8\u6001\u5206\u5e03\u4e2d\u5fc3 \u03bc = ${mu}${data.temp_symbol || "\u00b0C"}</div>`;
  }

  probs.forEach((p, i) => {
    const pct = Math.round(Number(p.probability || 0) * 100);
    html += `
        <div class="prob-row">
        <div class="prob-label">${p.value}${data.temp_symbol || "\u00B0C"}</div>
        <div class="prob-bar-track">
          <div class="prob-bar-fill rank-${i}" style="width:0%">${pct}%</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  requestAnimationFrame(() => {
    container.querySelectorAll(".prob-bar-fill").forEach((bar, i) => {
      const pct = Math.round(Number(probs[i].probability || 0) * 100);
      bar.style.width = `${Math.max(pct, 8)}%`;
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    return (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch] || ch
    );
  });
}

function formatCents(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return "--";
  const cents = Math.round(n * 1000) / 10;
  return Number.isInteger(cents) ? `${cents.toFixed(0)}c` : `${cents.toFixed(1)}c`;
}

function renderModels(data) {
  const container = document.getElementById("modelBars");
  if (!container) return;

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

  if (!Object.keys(models).length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">\u6682\u65e0\u591a\u6a21\u578b\u6570\u636e</div>';
    return;
  }

  const values = Object.values(models).filter((v) => v != null).map(Number);
  const minVal = Math.min(...values) - 1;
  const maxVal = Math.max(...values) + 1;
  const range = Math.max(maxVal - minVal, 1);

  let html = "";
  Object.entries(models)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .forEach(([name, val]) => {
      if (val == null) return;
      const pct = ((Number(val) - minVal) / range) * 100;
      html += `
        <div class="model-row">
          <div class="model-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="model-bar-track">
            <div class="model-bar-fill" style="width:${pct}%">${val}${data.temp_symbol || "?C"}</div>
            <div class="model-bar-fill" style="width:${pct}%">${val}${data.temp_symbol || "\u00B0C"}</div>
            ${deb != null ? `<div class="model-deb-line" style="left:${((Number(deb) - minVal) / range) * 100}%"></div>` : ""}
          </div>
        </div>
      `;
    });

  if (deb != null) {
    const pct = ((Number(deb) - minVal) / range) * 100;
    html += `
      <div class="model-row" style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">
        <div class="model-name" style="color:var(--accent-cyan);font-weight:700;">DEB</div>
        <div class="model-bar-track">
          <div class="model-bar-fill deb" style="width:${pct}%">${deb}${data.temp_symbol || "\u00B0C"}</div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function renderForecast(data) {
  const container = document.getElementById("forecastTable");
  const daily = data.forecast?.daily || [];
  const sym = data.temp_symbol || "\u00B0C";
  const todayDate = data.local_date;

  if (daily.length === 0) {
    container.innerHTML =
      '<div style="color:var(--text-muted);font-size:13px;">\u6682\u65e0\u591a\u65e5\u9884\u62a5</div>';
    return;
  }

  let html = "";
  daily.forEach((d, i) => {
    const isToday = d.date === todayDate || i === 0;
    const isSelected = isToday;
    const dateLabel = isToday
      ? "\u4eca\u5929"
      : d.date.substring(5).replace("-", "/");

    html += `
            <div class="forecast-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}"
                 onclick="switchForecastDate('${data.name}', '${d.date}')"
                 style="cursor:pointer;">
                <div class="f-date">${dateLabel}</div>
                <div class="f-temp">${d.max_temp}${sym}</div>
            </div>
        `;
  });
  container.innerHTML = html;

  const sunEl = document.getElementById("sunInfo");
  const parts = [];
  if (data.forecast?.sunrise) parts.push(`\u{1F305} ${data.forecast.sunrise}`);
  if (data.forecast?.sunset) parts.push(`\u{1F307} ${data.forecast.sunset}`);
  if (data.forecast?.sunshine_hours) parts.push(`\u2600\uFE0F ${data.forecast.sunshine_hours}h`);
  sunEl.innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
}

function switchForecastDate(cityName, dateStr) {
  if (selectedCity !== cityName) return;

  const data = cityDataCache[cityName];
  if (!data) return;

  if (dateStr === data.local_date) {
    selectedForecastDate = dateStr;
    renderModels(data);
    renderProbabilities(data);
    renderForecast(data);
    return;
  }

  openFutureForecastModal(data, dateStr);
}

function buildProbabilityBarsHtml(probabilities) {
  if (!probabilities || probabilities.length === 0) {
    return '<div style="color:var(--text-muted);font-size:13px;">\u6682\u65e0\u8be5\u65e5\u671f\u7ed3\u7b97\u6982\u7387\u5206\u5e03</div>';
  }

  return probabilities
    .slice(0, 6)
    .map((p, i) => {
      const label = p.label ?? p.bucket ?? (p.range ? `${p.value}${p.unit || ""} ${p.range}` : `${p.value}`);
      const pct = Math.round(Number(p.probability || 0) * 100);
      return `
        <div class="prob-row">
          <div class="prob-label">${escapeHtml(String(label))}</div>
          <div class="prob-bar-track">
            <div class="prob-bar-fill rank-${i}" style="width:${Math.max(pct, 8)}%">${pct}%</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function buildModelBarsHtml(models, deb, sym) {
  if (!models || Object.keys(models).length === 0) {
    return '<div style="color:var(--text-muted);font-size:13px;">\u6682\u65e0\u591a\u6a21\u578b\u9884\u62a5</div>';
  }

  const numericValues = Object.values(models)
    .filter((v) => Number.isFinite(Number(v)))
    .map(Number);
  if (!numericValues.length) {
    return '<div style="color:var(--text-muted);font-size:13px;">\u6682\u65e0\u591a\u6a21\u578b\u9884\u62a5</div>';
  }

  const comparisonValues = deb != null ? [...numericValues, Number(deb)] : numericValues;
  const minVal = Math.min(...comparisonValues) - 1;
  const maxVal = Math.max(...comparisonValues) + 1;
  const range = Math.max(maxVal - minVal, 1);

  let html = "";
  Object.entries(models)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .forEach(([name, val]) => {
      if (!Number.isFinite(Number(val))) return;
      const numVal = Number(val);
      const pct = ((numVal - minVal) / range) * 100;
      html += `
        <div class="model-row">
          <div class="model-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="model-bar-track">
            <div class="model-bar-fill" style="width:${pct}%">${numVal}${sym}</div>
            ${deb != null ? `<div class="model-deb-line" style="left:${((Number(deb) - minVal) / range) * 100}%"></div>` : ""}
          </div>
        </div>
      `;
    });

  if (deb != null && Number.isFinite(Number(deb))) {
    const pct = ((Number(deb) - minVal) / range) * 100;
    html += `
      <div class="model-row" style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">
        <div class="model-name" style="color:var(--accent-cyan);font-weight:700;">DEB</div>
        <div class="model-bar-track">
          <div class="model-bar-fill deb" style="width:${pct}%">${Number(deb)}${sym}</div>
        </div>
      </div>
    `;
  }

  return html;
}

function getFutureSlice(data, dateStr) {
  const hourly = data.hourly_next_48h || {};
  const times = hourly.times || [];
  const out = [];

  for (let i = 0; i < times.length; i += 1) {
    const ts = times[i];
    if (!ts || !String(ts).startsWith(dateStr)) continue;
    out.push({
      time: ts,
      label: String(ts).split("T")[1]?.slice(0, 5) || ts,
      temp: hourly.temps?.[i] ?? null,
      dewPoint: hourly.dew_point?.[i] ?? null,
      pressure: hourly.pressure_msl?.[i] ?? null,
      windSpeed: hourly.wind_speed_10m?.[i] ?? null,
      windDir: hourly.wind_direction_10m?.[i] ?? null,
      precipProb: hourly.precipitation_probability?.[i] ?? null,
      cloudCover: hourly.cloud_cover?.[i] ?? null,
      radiation: hourly.radiation?.[i] ?? null,
    });
  }

  return out;
}

function trendBucketFromDir(dir) {
  const n = Number(dir);
  if (!Number.isFinite(n)) return null;
  if (n >= 135 && n <= 240) return "southerly";
  if (n >= 290 || n <= 45) return "northerly";
  if (n > 45 && n < 135) return "easterly";
  return "westerly";
}

function bucketLabel(bucket) {
  return {
    southerly: "\u5357 / \u897f\u5357\u98ce",
    northerly: "\u5317 / \u897f\u5317\u98ce",
    easterly: "\u4e1c\u98ce",
    westerly: "\u897f\u98ce",
  }[bucket] || "\u98ce\u5411\u4e0d\u660e";
}

function formatDelta(value, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}${suffix}`;
}

function buildTrendCards(metrics) {
  return metrics
    .map((metric) => {
      const toneClass = metric.tone ? ` ${metric.tone}` : "";
      return `
        <div class="future-trend-card">
          <div class="future-trend-label">${escapeHtml(metric.label)}</div>
          <div class="future-trend-value${toneClass}">${escapeHtml(metric.value)}</div>
          <div class="future-trend-note">${escapeHtml(metric.note)}</div>
        </div>
      `;
    })
    .join("");
}

function computeProbabilityMu(probabilities) {
  if (!Array.isArray(probabilities) || !probabilities.length) return null;
  let weighted = 0;
  let total = 0;
  probabilities.forEach((item) => {
    const value = Number(item.value);
    const prob = Number(item.probability);
    if (!Number.isFinite(value) || !Number.isFinite(prob)) return;
    weighted += value * prob;
    total += prob;
  });
  if (!total) return null;
  return weighted / total;
}

function getForecastTextForDate(data, dateStr) {
  const weatherGov = data.source_forecasts?.weather_gov || {};
  const periods = Array.isArray(weatherGov.forecast_periods)
    ? weatherGov.forecast_periods
    : [];

  return periods.filter((period) =>
    String(period.start_time || "").startsWith(dateStr),
  );
}

function computeFrontTrendSignal(data, dateStr) {
  const slice = getFutureSlice(data, dateStr);
  const currentTemp = Number(data.current?.temp);
  const currentDew = Number(data.current?.dewpoint);

  if (!slice.length) {
    return {
      score: 0,
      label: "\u76d1\u63a7\u4e2d",
      confidence: "low",
      summary:
        "\u672a\u6765 48 \u5c0f\u65f6\u7ed3\u6784\u5316\u6570\u636e\u4e0d\u8db3\uff0c\u6682\u65f6\u53ea\u4fdd\u7559\u57fa\u7840\u76d1\u63a7\u3002",
      metrics: [],
      directionLabel: "\u98ce\u5411\u4e0d\u660e",
      precipMax: 0,
      weatherGovPeriods: [],
    };
  }

  const first = slice[0];
  const last = slice[slice.length - 1];
  const firstTemp = Number.isFinite(first.temp) ? Number(first.temp) : currentTemp;
  const lastTemp = Number.isFinite(last.temp) ? Number(last.temp) : firstTemp;
  const tempDelta =
    Number.isFinite(firstTemp) && Number.isFinite(lastTemp)
      ? lastTemp - firstTemp
      : 0;

  const firstDew = Number.isFinite(first.dewPoint)
    ? Number(first.dewPoint)
    : currentDew;
  const lastDew = Number.isFinite(last.dewPoint)
    ? Number(last.dewPoint)
    : firstDew;
  const dewDelta =
    Number.isFinite(firstDew) && Number.isFinite(lastDew)
      ? lastDew - firstDew
      : 0;

  const firstPressure = Number.isFinite(first.pressure)
    ? Number(first.pressure)
    : null;
  const lastPressure = Number.isFinite(last.pressure)
    ? Number(last.pressure)
    : firstPressure;
  const pressureDelta =
    Number.isFinite(firstPressure) && Number.isFinite(lastPressure)
      ? lastPressure - firstPressure
      : 0;

  const firstCloud = Number.isFinite(first.cloudCover)
    ? Number(first.cloudCover)
    : null;
  const lastCloud = Number.isFinite(last.cloudCover)
    ? Number(last.cloudCover)
    : firstCloud;
  const cloudDelta =
    Number.isFinite(firstCloud) && Number.isFinite(lastCloud)
      ? lastCloud - firstCloud
      : 0;

  const precipMax = slice.reduce(
    (max, point) => Math.max(max, Number(point.precipProb) || 0),
    0,
  );
  const firstBucket = trendBucketFromDir(first.windDir);
  const lastBucket = trendBucketFromDir(last.windDir);
  const weatherGovPeriods = getForecastTextForDate(data, dateStr);
  const weatherGovText = weatherGovPeriods
    .map(
      (period) =>
        `${period.short_forecast || ""} ${period.detailed_forecast || ""}`.toLowerCase(),
    )
    .join(" ");

  let warmScore = 0;
  let coldScore = 0;

  if (tempDelta >= 2) warmScore += 24;
  else if (tempDelta >= 0.8) warmScore += 12;
  if (tempDelta <= -2) coldScore += 24;
  else if (tempDelta <= -0.8) coldScore += 12;

  if (dewDelta >= 1.2) warmScore += 14;
  if (dewDelta <= -1.2) coldScore += 10;

  if (Number.isFinite(pressureDelta) && pressureDelta >= 1.2) coldScore += 16;
  if (Number.isFinite(pressureDelta) && pressureDelta <= -1.0) warmScore += 8;

  if (lastBucket === "southerly") warmScore += 14;
  if (firstBucket !== lastBucket && lastBucket === "southerly") warmScore += 10;
  if (lastBucket === "northerly") coldScore += 14;
  if (firstBucket !== lastBucket && lastBucket === "northerly") coldScore += 10;

  if (cloudDelta >= 15 && tempDelta >= 0) warmScore += 6;
  if (cloudDelta >= 15 && tempDelta < 0) coldScore += 8;
  if (precipMax >= 40) coldScore += 8;

  if (
    weatherGovText.includes("cold front") ||
    weatherGovText.includes("temperatures falling")
  ) {
    coldScore += 18;
  }
  if (weatherGovText.includes("warm front") || weatherGovText.includes("warmer")) {
    warmScore += 18;
  }
  if (weatherGovText.includes("thunder") || weatherGovText.includes("snow")) {
    coldScore += 8;
  }

  const score = Math.max(-100, Math.min(100, warmScore - coldScore));
  let label = "\u76d1\u63a7\u4e2d";
  if (score >= 18) label = "\u6696\u950b / \u6696\u5e73\u6d41\u503e\u5411";
  else if (score <= -18) label = "\u51b7\u950b / \u51b7\u5e73\u6d41\u503e\u5411";

  const absScore = Math.abs(score);
  const confidence = absScore >= 45 ? "high" : absScore >= 22 ? "medium" : "low";

  const metrics = [
    {
      label: "\u6e29\u5ea6\u53d8\u5316",
      value: formatDelta(tempDelta, data.temp_symbol || "\u00B0C"),
      note: "Open-Meteo \u672a\u6765\u5c0f\u65f6\u6e29\u5ea6\u53d8\u5316",
      tone: tempDelta >= 0.8 ? "warm" : tempDelta <= -0.8 ? "cold" : "",
    },
    {
      label: "\u9732\u70b9\u53d8\u5316",
      value: formatDelta(dewDelta, data.temp_symbol || "\u00B0C"),
      note: "\u9732\u70b9\u4e0a\u5347\u66f4\u504f\u5411\u6696\u6e7f\u5e73\u6d41",
      tone: dewDelta >= 0.8 ? "warm" : dewDelta <= -0.8 ? "cold" : "",
    },
    {
      label: "\u6c14\u538b\u53d8\u5316",
      value: formatDelta(pressureDelta, " hPa"),
      note: "\u6c14\u538b\u56de\u5347\u66f4\u504f\u5411\u51b7\u7a7a\u6c14\u5165\u4fb5",
      tone: pressureDelta >= 1 ? "cold" : pressureDelta <= -1 ? "warm" : "",
    },
    {
      label: "\u98ce\u5411\u6f14\u53d8",
      value: `${bucketLabel(firstBucket)} \u2192 ${bucketLabel(lastBucket)}`,
      note: "\u5173\u6ce8\u662f\u5426\u8f6c\u5357\u98ce\u6216\u8f6c\u5317\u98ce",
    },
    {
      label: "\u964d\u6c34\u6982\u7387",
      value: `${Math.round(precipMax)}%`,
      note: "weather.gov / Open-Meteo \u964d\u6c34\u63d0\u793a",
      tone: precipMax >= 50 ? "cold" : "",
    },
    {
      label: "\u4e91\u91cf\u53d8\u5316",
      value: formatDelta(cloudDelta, "%"),
      note: "\u4e91\u91cf\u62ac\u5347\u4f46\u672a\u964d\u6e29\uff0c\u5e38\u89c1\u4e8e\u6696\u5e73\u6d41\u524d\u6bb5",
      tone:
        cloudDelta >= 15 && tempDelta >= 0
          ? "warm"
          : cloudDelta >= 15 && tempDelta < 0
            ? "cold"
            : "",
    },
  ];

    const usesMeteoblue = data.name !== "ankara" && Boolean(data.source_forecasts?.meteoblue);
    let summary = usesMeteoblue
      ? "\u7ed3\u6784\u5316\u6765\u6e90\u4ee5 weather.gov\u3001Open-Meteo\u3001Meteoblue \u4e3a\u4e3b\uff0c\u7528\u4e8e\u5224\u65ad\u672a\u6765 6-48 \u5c0f\u65f6\u51b7\u6696\u5e73\u6d41\u8d8b\u52bf\u3002"
      : "\u7ed3\u6784\u5316\u6765\u6e90\u4ee5 weather.gov \u4e0e Open-Meteo \u4e3a\u4e3b\uff0c\u7528\u4e8e\u5224\u65ad\u672a\u6765 6-48 \u5c0f\u65f6\u51b7\u6696\u5e73\u6d41\u8d8b\u52bf\u3002";
  if (label === "\u6696\u950b / \u6696\u5e73\u6d41\u503e\u5411") {
    summary =
      "\u98ce\u5411\u66f4\u504f\u5357 / \u897f\u5357\uff0c\u9732\u70b9\u4e0e\u6e29\u5ea6\u6574\u4f53\u62ac\u5347\uff0c\u672a\u6765 6-48 \u5c0f\u65f6\u504f\u5411\u6696\u5e73\u6d41\u3002";
  } else if (label === "\u51b7\u950b / \u51b7\u5e73\u6d41\u503e\u5411") {
    summary =
      "\u6e29\u5ea6\u4e0b\u6ed1\u3001\u6c14\u538b\u56de\u5347\u6216\u98ce\u5411\u8f6c\u5317\uff0c\u672a\u6765 6-48 \u5c0f\u65f6\u66f4\u50cf\u51b7\u950b\u6216\u51b7\u5e73\u6d41\u538b\u5236\u3002";
  }

  return {
    score,
    label,
    confidence,
    summary,
    metrics,
    directionLabel: bucketLabel(lastBucket),
    precipMax,
    weatherGovPeriods,
  };
}

function buildShortTermNowcast(data, dateStr) {
  if (dateStr && dateStr !== data.local_date) {
    return `
      <div><strong>适用范围：</strong>近 0-2 小时临近判断只适用于当前日期，不适用于未来日期。</div>
      <div><strong>目标日期：</strong>${escapeHtml(dateStr)}</div>
      <div><strong>当前主站：</strong>${data.current?.temp ?? "--"}${data.temp_symbol || "\u00B0C"} @ ${data.current?.obs_time || "--"}</div>
      <div><strong>说明：</strong>未来日期请主要参考上方温度走势、结算概率分布、多模型预报，以及未来 6-48 小时趋势。</div>
    `;
  }

  const current = data.current || {};
  const recent = Array.isArray(data.metar_recent_obs)
    ? data.metar_recent_obs.slice(-4)
    : [];
  const nearby = Array.isArray(data.mgm_nearby) ? data.mgm_nearby : [];
  const sourceLabel =
    data.name === "ankara"
      ? "MGM \u5468\u8fb9\u7ad9"
      : "METAR \u5468\u8fb9\u7ad9";
  const nearbyCount = nearby.length;
  const currentTemp = Number(current.temp);
  const recentTemps = recent
    .map((point) => Number(point.temp))
    .filter((v) => Number.isFinite(v));
  const baseline = recentTemps.length ? recentTemps[0] : currentTemp;
  const shortDelta =
    Number.isFinite(currentTemp) && Number.isFinite(baseline)
      ? currentTemp - baseline
      : 0;

  let nearbyLead = null;
  nearby.forEach((station) => {
    const temp = Number(station.temp);
    if (!Number.isFinite(temp) || !Number.isFinite(currentTemp)) return;
    const diff = temp - currentTemp;
    if (!nearbyLead || Math.abs(diff) > Math.abs(nearbyLead.diff)) {
      nearbyLead = {
        name: station.name || station.icao || "\u5468\u8fb9\u7ad9",
        diff,
        temp,
      };
    }
  });

  const lines = [];
  lines.push(
    `<div><strong>\u5f53\u524d\u4e3b\u7ad9\uff1a</strong>${current.temp ?? "--"}${data.temp_symbol || "\u00B0C"} @ ${current.obs_time || "--"}</div>`,
  );
  lines.push(
    `<div><strong>\u539f\u59cb METAR\uff1a</strong>${escapeHtml(current.raw_metar || "\u6682\u65e0")}</div>`,
  );
  lines.push(
    `<div><strong>\u8fd1 0-2 \u5c0f\u65f6\uff1a</strong>${formatDelta(shortDelta, data.temp_symbol || "\u00B0C")}\uff0c\u4f9d\u636e\u6700\u8fd1 METAR \u5e8f\u5217\u5224\u65ad\u77ed\u65f6\u52a8\u91cf\u3002</div>`,
  );
  lines.push(
    `<div><strong>${sourceLabel}\uff1a</strong>${nearbyCount} \u4e2a\u7ad9\u70b9\u53c2\u4e0e\u90bb\u8fd1\u76d1\u63a7\u3002</div>`,
  );

  if (nearbyLead) {
    const tone =
      nearbyLead.diff > 0
        ? "\u504f\u6696"
        : nearbyLead.diff < 0
          ? "\u504f\u51b7"
          : "\u6301\u5e73";
    lines.push(
      `<div><strong>\u9886\u5148\u7ad9\uff1a</strong>${escapeHtml(nearbyLead.name)} ${nearbyLead.temp}${data.temp_symbol || "\u00B0C"}\uff0c\u76f8\u5bf9\u4e3b\u7ad9 ${formatDelta(nearbyLead.diff, data.temp_symbol || "\u00B0C")}\uff08${tone}\uff09\u3002</div>`,
    );
  }

  lines.push(
    "<div><strong>\u5de5\u7a0b\u53e3\u5f84\uff1a</strong>\u77ed\u65f6\u5224\u65ad\u4ee5 METAR \u4e3b\u7ad9\u4e3a\u51c6\uff1bAnkara \u53e0\u52a0 MGM \u5468\u8fb9\u7ad9\uff0c\u7f8e\u56fd\u57ce\u5e02\u540e\u7eed\u53ef\u53e0\u52a0 Mesonet \u4f5c\u4e3a\u589e\u5f3a\u5c42\u3002</div>",
  );
  return lines.join("");
}

function renderFutureForecastChart(data, dateStr, slice) {
  const canvas = document.getElementById("futureForecastChart");
  if (!canvas) return;

  if (futureForecastChart) {
    futureForecastChart.destroy();
    futureForecastChart = null;
  }

  const ctx = canvas.getContext("2d");
  const labels = slice.map((point) => point.label);
  const sym = data.temp_symbol || "\u00B0C";

  futureForecastChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Open-Meteo \u6e29\u5ea6",
          data: slice.map((point) => point.temp),
          borderColor: "#22d3ee",
          backgroundColor: "rgba(34, 211, 238, 0.08)",
          tension: 0.28,
          pointRadius: 2,
          fill: false,
        },
        {
          label: "\u9732\u70b9",
          data: slice.map((point) => point.dewPoint),
          borderColor: "#a78bfa",
          backgroundColor: "transparent",
          borderDash: [5, 4],
          tension: 0.24,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: {
          labels: {
            color: "#94a3b8",
            font: { family: "Inter", size: 11 },
          },
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.96)",
          borderColor: "rgba(34, 211, 238, 0.2)",
          borderWidth: 1,
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}${sym}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: {
            color: "#64748b",
            font: { family: "Inter", size: 10 },
            maxRotation: 0,
          },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: {
            color: "#64748b",
            font: { family: "Inter", size: 10 },
            callback: (value) => `${value}${sym}`,
          },
        },
      },
    },
  });
}

function openFutureForecastModal(data, dateStr) {
  const modal = document.getElementById("futureForecastModal");
  const title = document.getElementById("futureForecastTitle");
  const stats = document.getElementById("futureForecastStats");
  const probBars = document.getElementById("futureProbBars");
  const modelBars = document.getElementById("futureModelBars");
  const trendGrid = document.getElementById("futureTrendGrid");
  const nowcast = document.getElementById("futureNowcast");
  const sym = data.temp_symbol || "\u00B0C";

  const forecastEntry = (data.forecast?.daily || []).find((item) => item.date === dateStr) || null;
  const dailyModel = data.multi_model_daily?.[dateStr] || {};
  const probabilities = dailyModel.probabilities || [];
  const mu = computeProbabilityMu(probabilities);
  const deb = dailyModel.deb?.prediction ?? forecastEntry?.max_temp ?? null;
  const models = dailyModel.models || {};
  const slice = getFutureSlice(data, dateStr);
  const front = computeFrontTrendSignal(data, dateStr);
  const weatherGovPeriods = front.weatherGovPeriods || [];
  const meteoblueHighs = data.source_forecasts?.meteoblue?.daily_highs || [];
  const meteoblueIndex = (data.forecast?.daily || []).findIndex((item) => item.date === dateStr);
  const meteoblueHigh = meteoblueIndex >= 0 ? meteoblueHighs[meteoblueIndex] : null;
  const hasMeteoblue =
    data.name !== "ankara" &&
    meteoblueHigh != null &&
    Number.isFinite(Number(meteoblueHigh));
  title.textContent = `${data.display_name.toUpperCase()} \u00B7 ${dateStr} \u672a\u6765\u65e5\u671f\u5206\u6790`;

  stats.innerHTML = `
      <div class="h-stat-card"><span class="label">\u76ee\u6807\u65e5\u9884\u62a5</span><span class="val">${forecastEntry?.max_temp ?? "--"}${sym}</span></div>
      <div class="h-stat-card"><span class="label">DEB \u9884\u62a5</span><span class="val">${deb ?? "--"}${sym}</span></div>
      <div class="h-stat-card"><span class="label">\u52a8\u6001\u5206\u5e03\u4e2d\u5fc3</span><span class="val">${mu != null ? `${mu.toFixed(1)}${sym}` : "--"}</span></div>
      <div class="h-stat-card"><span class="label">\u8d8b\u52bf\u8bc4\u5206</span><span class="val">${front.score > 0 ? "+" : ""}${front.score}</span></div>
  `;

  probBars.innerHTML = buildProbabilityBarsHtml(probabilities);
  modelBars.innerHTML = buildModelBarsHtml(models, deb, sym);
  trendGrid.innerHTML = buildTrendCards(front.metrics);
  nowcast.innerHTML = buildShortTermNowcast(data, dateStr);

  renderFutureForecastChart(data, dateStr, slice);
  modal.classList.remove("hidden");
}

function closeFutureForecastModal() {
  document.getElementById("futureForecastModal")?.classList.add("hidden");
  if (futureForecastChart) {
    futureForecastChart.destroy();
    futureForecastChart = null;
  }
}

function renderRisk(data) {
  const container = document.getElementById("riskInfo");
  const risk = data.risk || {};

  if (!risk.airport) {
    container.innerHTML =
      '<span style="color:var(--text-muted)">暂无风险档案</span>';
    return;
  }

  container.innerHTML = `
        <div class="risk-row"><span class="risk-label">\u{1F4CD} 机场</span><span>${risk.airport} (${risk.icao})</span></div>
        <div class="risk-row"><span class="risk-label">\u{1F4CF} 距离</span><span>${risk.distance_km}km</span></div>
        ${risk.warning ? `<div class="risk-row"><span class="risk-label">\u26A0\uFE0F 注意</span><span>${risk.warning}</span></div>` : ""}
    `;
}

// ------------------------------------------------------------
// Panel controls
// ------------------------------------------------------------
function closePanel() {
  const panel = document.getElementById("panel");
  panel.classList.remove("visible");
  setTimeout(() => panel.classList.add("hidden"), 400);

  selectedCity = null;
  setSelectedMarker(null);
  document
    .querySelectorAll(".city-item")
    .forEach((el) => el.classList.remove("active"));
  maybeAutoShowNearbyStations();
}

// ------------------------------------------------------------
// Auto refresh
// ------------------------------------------------------------
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
          updateMarkerTemp(selectedCity, data.current.temp);
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

// ------------------------------------------------------------
//  Background Progressive Loading
// ------------------------------------------------------------
async function loadAllCitiesProgressively(cities) {
  // 寤惰繜 1 绉掑悗寮€濮嬪悗鍙板姞杞斤紝閬垮厤闃诲鍒濆娓叉煋
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

          // If the user is not focused on this city, only refresh marker and list info
          if (data.current?.temp != null) {
            updateMarkerTemp(city.name, data.current.temp);
            updateCityListInfo(data);
          }

          // If the user is currently focused on this city, refresh the panel too
          if (selectedCity === city.name) {
            renderPanel(data);
          }
        }
      } catch (e) {
        console.warn(`Background load failed for ${city.name}`, e);
      }
      // Delay 2000ms to avoid bursty background API requests and keep the UI responsive
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ------------------------------------------------------------
//  History Chart Logic
// ------------------------------------------------------------
let historyChartInst = null;

async function openHistoryModal() {
  if (!selectedCity) return;

  const modal = document.getElementById("historyModal");
  const title = document.getElementById("historyModalTitle");
  const statsDiv = document.getElementById("historyStats");

  modal.classList.remove("hidden");
  title.textContent = `\u5386\u53f2\u51c6\u786e\u7387\u5bf9\u8d26 - ${selectedCity.toUpperCase()}`;
  statsDiv.innerHTML =
    '<span style="color:var(--text-muted)">\u6b63\u5728\u83b7\u53d6\u5386\u53f2\u6570\u636e...</span>';

  try {
    const res = await fetch(`/api/history/${encodeURIComponent(selectedCity)}`);
    const json = await res.json();
    const data = json.history || [];
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 14);
    const recentData = data.filter((row) => {
      if (!row?.date) return false;
      const rowDate = new Date(`${row.date}T00:00:00`);
      return !Number.isNaN(rowDate.getTime()) && rowDate >= cutoff;
    });

    if (recentData.length === 0) {
      statsDiv.innerHTML =
        '<span style="color:var(--text-muted)">\u8fd115\u5929\u6682\u65e0\u8be5\u57ce\u5e02\u5386\u53f2\u6570\u636e</span>';
      if (historyChartInst) historyChartInst.destroy();
      return;
    }

    let hits = 0;
    const debErrors = [];
    const dates = [];
    const actuals = [];
    const debs = [];
    const mgms = [];
    const cityLocalDate = cityDataCache?.[selectedCity]?.local_date || null;
    const settledData = recentData.filter((row) => {
      if (!row?.date) return false;
      return cityLocalDate
        ? row.date < cityLocalDate
        : row.date < new Date().toISOString().slice(0, 10);
    });

    recentData.forEach((row) => {
      dates.push(row.date);
      actuals.push(row.actual);
      debs.push(row.deb);
      mgms.push(row.mgm);
    });

    settledData.forEach((row) => {
      if (row.actual != null && row.deb != null) {
        debErrors.push(Math.abs(row.actual - row.deb));
        if (Math.round(row.actual) === Math.round(row.deb)) {
          hits++;
        }
      }
    });

    const hitRate = debErrors.length
      ? ((hits / debErrors.length) * 100).toFixed(0)
      : "--";
    const debMae = debErrors.length
      ? (debErrors.reduce((a, b) => a + b, 0) / debErrors.length).toFixed(1)
      : "--";
    const hasMgm =
      selectedCity === "ankara" && mgms.some((value) => value != null);

    statsDiv.innerHTML = `
      <div class="h-stat-card"><span class="label">DEB \u7ed3\u7b97\u80dc\u7387 (WU)</span><span class="val">${hitRate === "--" ? "--" : `${hitRate}%`}</span></div>
      <div class="h-stat-card"><span class="label">DEB MAE</span><span class="val">${debMae}&deg;</span></div>
      <div class="h-stat-card"><span class="label">\u8fd115\u5929\u5df2\u7ed3\u7b97\u6837\u672c</span><span class="val">${settledData.length}\u5929</span></div>
    `;

    const datasets = [
      {
        label: "\u5b9e\u6d4b\u6700\u9ad8\u6e29",
        data: actuals,
        borderColor: "#f87171",
        backgroundColor: "rgba(248, 113, 113, 0.1)",
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 4,
        pointBackgroundColor: "#f87171",
        pointBorderColor: "#fff",
        zIndex: 10,
      },
      {
        label: "DEB \u878d\u5408",
        data: debs,
        borderColor: "#34d399",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.2,
        pointRadius: 3,
      },
    ];

    if (hasMgm) {
      datasets.push({
        label: "MGM \u5b98\u65b9\u9884\u62a5",
        data: mgms,
        borderColor: "#fb923c",
        backgroundColor: "transparent",
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 3,
      });
    }

    if (historyChartInst) historyChartInst.destroy();
    const ctx = document.getElementById("historyChart").getContext("2d");

    historyChartInst = new Chart(ctx, {
      type: "line",
      data: {
        labels: dates,
        datasets,
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
          '<span style="color:var(--text-danger)">\u83b7\u53d6\u5386\u53f2\u4fe1\u606f\u5931\u8d25</span>';
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
  const futureModal = document.getElementById("futureForecastModal");
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
  document
    .getElementById("futureForecastClose")
    .addEventListener("click", closeFutureForecastModal);
  futureModal.addEventListener("click", (e) => {
    if (e.target.id === "futureForecastModal") closeFutureForecastModal();
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
        c._temp = cached.current.temp;
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

    // Warm cache in the background after boot
    loadAllCitiesProgressively(cities);
  }

  startAutoRefresh();
});


