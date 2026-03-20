const DEFAULT_CONFIG = {
  apiBase: "https://polyweather-pro.vercel.app",
  siteBase: "https://polyweather-pro.vercel.app",
  authToken: "",
  selectedCity: ""
};
const locale = String(navigator.language || "en").toLowerCase().startsWith("zh")
  ? "zh"
  : "en";
const I18N = {
  zh: {
    settingsTitle: "PolyWeather 侧边栏设置",
    tokenLabel: "Bearer Token（可选）",
    tokenPlaceholder: "公开模式留空即可；仅当后端返回 401 时再填写。",
    save: "保存",
    test: "测试 /api/cities",
    saved: "已保存。公开模式下 Token 可留空。",
    connectOk: "连接成功，返回城市数",
    tokenOptional: "Token 可留空",
    testFailed: "测试失败",
    backendAuthHint: "说明后端仍要求鉴权；若你要公开插件，请先放开 /api/cities 与 /api/city/*/detail。"
  },
  en: {
    settingsTitle: "PolyWeather Side Panel Settings",
    tokenLabel: "Bearer Token (Optional)",
    tokenPlaceholder: "Leave empty in public mode; only fill it if the backend returns 401.",
    save: "Save",
    test: "Test /api/cities",
    saved: "Saved. Token can be empty in public mode.",
    connectOk: "Connected successfully, city count",
    tokenOptional: "Token can be empty",
    testFailed: "Test failed",
    backendAuthHint: "The backend still requires auth. If the extension should be public, allow /api/cities and /api/city/*/detail."
  }
};

function t(key) {
  return I18N[locale][key] || I18N.zh[key] || key;
}

const apiBaseInput = document.getElementById("apiBaseInput");
const siteBaseInput = document.getElementById("siteBaseInput");
const tokenInput = document.getElementById("tokenInput");
const resultBox = document.getElementById("resultBox");
const settingsTitle = document.getElementById("settingsTitle");
const siteBaseLabel = document.getElementById("siteBaseLabel");
const apiBaseLabel = document.getElementById("apiBaseLabel");
const tokenLabel = document.getElementById("tokenLabel");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");

function normalizeBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function writeResult(text) {
  resultBox.textContent = text;
}

function getStorage() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => resolve(items));
  });
}

function setStorage(values) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, resolve);
  });
}

async function loadForm() {
  const cfg = await getStorage();
  apiBaseInput.value = cfg.apiBase || DEFAULT_CONFIG.apiBase;
  siteBaseInput.value = cfg.siteBase || cfg.apiBase || DEFAULT_CONFIG.siteBase;
  tokenInput.value = cfg.authToken || "";
}

async function saveForm() {
  const next = {
    apiBase: normalizeBase(apiBaseInput.value),
    siteBase: normalizeBase(siteBaseInput.value || apiBaseInput.value),
    authToken: String(tokenInput.value || "").trim()
  };
  await setStorage(next);
  writeResult(t("saved"));
}

async function testApi() {
  const apiBase = normalizeBase(apiBaseInput.value);
  const authToken = String(tokenInput.value || "").trim();
  try {
    const headers = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(`${apiBase}/api/cities`, {
      headers,
      cache: "no-store"
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_e) {
      data = text;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    }
    const count = Array.isArray(data)
      ? data.length
      : Array.isArray(data?.cities)
        ? data.cities.length
        : 0;
    writeResult(`${t("connectOk")}: ${count} (${t("tokenOptional")})`);
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (msg.includes("HTTP 401")) {
      writeResult(`${t("testFailed")}: ${msg}\n${t("backendAuthHint")}`);
      return;
    }
    writeResult(`${t("testFailed")}: ${msg}`);
  }
}

function applyStaticTranslations() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  if (settingsTitle) settingsTitle.textContent = t("settingsTitle");
  if (tokenLabel) tokenLabel.textContent = t("tokenLabel");
  if (tokenInput) tokenInput.placeholder = t("tokenPlaceholder");
  if (saveBtn) saveBtn.textContent = t("save");
  if (testBtn) testBtn.textContent = t("test");
  if (siteBaseLabel) siteBaseLabel.textContent = "Site Base URL";
  if (apiBaseLabel) apiBaseLabel.textContent = "API Base URL";
}

document.getElementById("saveBtn").addEventListener("click", () => {
  void saveForm();
});
document.getElementById("testBtn").addEventListener("click", () => {
  void testApi();
});

applyStaticTranslations();
void loadForm();
