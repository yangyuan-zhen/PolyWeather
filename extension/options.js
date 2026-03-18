const DEFAULT_CONFIG = {
  apiBase: "https://polyweather-pro.vercel.app",
  siteBase: "https://polyweather-pro.vercel.app",
  authToken: "",
  selectedCity: ""
};

const apiBaseInput = document.getElementById("apiBaseInput");
const siteBaseInput = document.getElementById("siteBaseInput");
const tokenInput = document.getElementById("tokenInput");
const resultBox = document.getElementById("resultBox");

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
  writeResult("已保存。公开模式下 Token 可留空。");
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
    writeResult(`连接成功，返回城市数: ${count}（Token 可留空）`);
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (msg.includes("HTTP 401")) {
      writeResult(`测试失败: ${msg}\n说明后端仍要求鉴权；若你要公开插件，请先放开 /api/cities 与 /api/city/*/detail。`);
      return;
    }
    writeResult(`测试失败: ${msg}`);
  }
}

document.getElementById("saveBtn").addEventListener("click", () => {
  void saveForm();
});
document.getElementById("testBtn").addEventListener("click", () => {
  void testApi();
});

void loadForm();
