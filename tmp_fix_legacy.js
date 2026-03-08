const fs = require('fs');

function replaceRegex(content, regex, replacement, label) {
  const next = content.replace(regex, replacement);
  if (next === content) {
    console.error('No match for', label);
  }
  return next;
}

const appJsPath = 'E:/web/PolyWeather/frontend/public/static/app.js';
let app = fs.readFileSync(appJsPath, 'utf8');

app = replaceRegex(app, /function updateCityListInfo\(cityData\) \{[\s\S]*?\n\}/, `function updateCityListInfo(cityData) {
  const cityName = cityData.name;
  const cityId = cityName.replace(/\\s/g, "-");
  const temp = cityData.current?.temp;

  const tempEl = document.getElementById(\`temp-\${cityId}\`);
  if (tempEl && temp != null) {
    tempEl.textContent = \`\${temp}\${cityData.temp_symbol}\`;
    tempEl.classList.add("loaded");
  }

  const timeEl = document.getElementById(\`time-\${cityId}\`);
  if (timeEl && cityData.local_time) {
    timeEl.textContent = \`🕐 \${cityData.local_time}\`;
  }

  const maxEl = document.getElementById(\`max-\${cityId}\`);
  if (maxEl && cityData.current?.max_temp_time) {
    maxEl.textContent = \`峰值 @\${cityData.current.max_temp_time}\`;
  }
}`,'updateCityListInfo');

app = app.replace(/alert\(`[^`]*cityName[^`]*`\);/, 'alert(`加载 ${cityName} 数据失败：${e.message}`);');

app = replaceRegex(app, /function renderPanel\(data\) \{[\s\S]*?\n\}/, `function renderPanel(data) {
  const panel = document.getElementById("panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  requestAnimationFrame(() => panel.classList.add("visible"));

  const panelCityName = document.getElementById("panelCityName");
  const panelLocalTime = document.getElementById("panelLocalTime");
  const badge = document.getElementById("panelRiskBadge");

  if (panelCityName) {
    panelCityName.textContent = \`\${data.risk?.emoji || "🏙️"} \${data.display_name}\`;
  }
  if (panelLocalTime) {
    panelLocalTime.textContent = \`🕐 \${data.local_time || "--:--"} 当地时间\`;
  }
  if (badge) {
    badge.textContent = {
      high: "🔴 高危",
      medium: "🟡 中危",
      low: "🟢 低危",
    }[data.risk?.level] || "未知";
    badge.className = \`risk-badge \${data.risk?.level || "low"}\`;
  }

  renderHero(data);
  renderChart(data);
  renderProbabilities(data);
  if (!selectedForecastDate) {
    selectedForecastDate = data.local_date;
  }
  renderModels(data);
  renderForecast(data);
  renderAI(data);
  renderRisk(data);
}`,'renderPanel');

app = replaceRegex(app, /const METAR_WX_MAP = \{[\s\S]*?\n\};/, `const METAR_WX_MAP = {
  RA: { label: "降雨", icon: "🌧️" },
  "-RA": { label: "小雨", icon: "🌦️" },
  "+RA": { label: "强降雨", icon: "⛈️" },
  SN: { label: "降雪", icon: "❄️" },
  "-SN": { label: "小雪", icon: "🌨️" },
  "+SN": { label: "大雪", icon: "🌨️" },
  DZ: { label: "毛毛雨", icon: "🌦️" },
  FG: { label: "雾", icon: "🌫️" },
  BR: { label: "薄雾", icon: "🌫️" },
  HZ: { label: "霾", icon: "🌫️" },
  TS: { label: "雷暴", icon: "⛈️" },
  VCTS: { label: "附近雷暴", icon: "⛈️" },
  SQ: { label: "飑", icon: "💨" },
  GS: { label: "冰雹", icon: "🌨️" },
};`, 'METAR_WX_MAP');

app = app.replace(/return \{ label: code, icon: .*? \};/, 'return { label: code, icon: "🌤️" };');

app = replaceRegex(app, /function renderHero\(data\) \{[\s\S]*?document.getElementById\("heroWeather"\)\.innerHTML = `/, `function renderHero(data) {
  const cur = data.current || {};
  const sym = data.temp_symbol || "°C";
  const displayTemp = cur.temp;

  let weatherText = cur.cloud_desc || "未知";
  let weatherIcon =
    {
      多云: "☁️",
      阴天: "☁️",
      少云: "🌤️",
      散云: "☁️",
      晴: "☀️",
      晴朗: "☀️",
    }[cur.cloud_desc] || "🌤️";

  if (cur.wx_desc) {
    const metarTranslation = translateMETAR(cur.wx_desc);
    if (metarTranslation) {
      weatherText = metarTranslation.label;
      weatherIcon = metarTranslation.icon;
    }
  }

  document.getElementById("heroWeather").innerHTML = ``, 'renderHeroPrefix');

fs.writeFileSync(appJsPath, app, 'utf8');

const pagePath = 'E:/web/PolyWeather/frontend/app/page.tsx';
let page = fs.readFileSync(pagePath, 'utf8');
page = page.replace(/legacy-v13/g, 'legacy-v14');
fs.writeFileSync(pagePath, page, 'utf8');

const htmlPath = 'E:/web/PolyWeather/frontend/public/legacy/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/legacy-v13/g, 'legacy-v14');
fs.writeFileSync(htmlPath, html, 'utf8');
