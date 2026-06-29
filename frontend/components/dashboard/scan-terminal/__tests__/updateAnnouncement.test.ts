import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const repoRoot = path.resolve(projectRoot, "..");
  const dashboardSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "ScanTerminalDashboard.tsx"),
    "utf8",
  );
  const opsConfigSource = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "config", "ConfigPageClient.tsx"),
    "utf8",
  );
  const nextRoutePath = path.join(
    projectRoot,
    "app",
    "api",
    "system",
    "update-announcement",
    "route.ts",
  );
  const componentPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "UpdateAnnouncementButton.tsx",
  );
  const opsApiSource = fs.readFileSync(path.join(repoRoot, "web", "services", "ops_api.py"), "utf8");
  const systemApiSource = fs.readFileSync(path.join(repoRoot, "web", "services", "system_api.py"), "utf8");
  const systemRouterSource = fs.readFileSync(path.join(repoRoot, "web", "routers", "system.py"), "utf8");
  const dbSource = fs.readFileSync(path.join(repoRoot, "src", "database", "db_manager.py"), "utf8");
  const middlewareSource = fs.readFileSync(path.join(projectRoot, "middleware.ts"), "utf8");

  assert(fs.existsSync(componentPath), "terminal must have a compact update announcement component");
  assert(!fs.existsSync(nextRoutePath), "update announcements should not depend on an admin-managed API proxy");

  const componentSource = fs.readFileSync(componentPath, "utf8");

  assert(
    dashboardSource.includes("UpdateAnnouncementButton") &&
      dashboardSource.includes("<UpdateAnnouncementButton") &&
      dashboardSource.includes("isEn={isEn}"),
    "terminal header must render a bilingual update announcement entry beside the dashboard title",
  );
  assert(
    componentSource.includes("STATIC_UPDATE_ANNOUNCEMENTS") &&
      componentSource.includes("expiresAt") &&
      componentSource.includes("Date.now()") &&
      componentSource.includes("Megaphone") &&
      componentSource.includes("zh") &&
      componentSource.includes("en") &&
      !componentSource.includes("fetch(") &&
      !componentSource.includes("/api/system/update-announcement") &&
      !componentSource.includes("setInterval("),
    "announcement component must use hardcoded zh/en release notes with an expiry time and no backend polling",
  );
  assert(
    componentSource.includes("polyweather_update_announcement_seen_v1") &&
      componentSource.includes("loadSeenAnnouncementIds") &&
      componentSource.includes("saveSeenAnnouncementIds") &&
      componentSource.includes("markAnnouncementAsSeen") &&
      componentSource.includes("announcement.id") &&
      componentSource.includes("scan-update-announcement-unread"),
    "announcement component must persist seen announcement ids and render an unread indicator for unseen updates",
  );
  assert(
    componentSource.includes("模型汇总表上线") &&
      componentSource.includes("模型汇总") &&
      componentSource.includes("当地时间") &&
      componentSource.includes("DEB") &&
      componentSource.includes("ECMWF") &&
      componentSource.includes("ECMWF AIFS") &&
      componentSource.includes("GFS") &&
      componentSource.includes("ICON-EU") &&
      componentSource.includes("JMA") &&
      componentSource.includes("AROME HD") &&
      componentSource.includes("HRRR") &&
      componentSource.includes("NAM") &&
      componentSource.includes("模型中位数") &&
      componentSource.includes("分歧范围") &&
      componentSource.includes("仅 DEB") &&
      componentSource.includes("分歧较大"),
    "terminal announcement should summarize the model summary table release in Chinese",
  );
  assert(
    componentSource.includes("Model Summary table is live") &&
      componentSource.includes("city-by-city table") &&
      componentSource.includes("local time") &&
      componentSource.includes("DEB") &&
      componentSource.includes("ECMWF") &&
      componentSource.includes("ECMWF AIFS") &&
      componentSource.includes("GFS") &&
      componentSource.includes("ICON-EU") &&
      componentSource.includes("JMA") &&
      componentSource.includes("AROME HD") &&
      componentSource.includes("HRRR") &&
      componentSource.includes("NAM") &&
      componentSource.includes("Model median") &&
      componentSource.includes("spread") &&
      componentSource.includes("Only DEB") &&
      componentSource.includes("Large spread"),
    "terminal announcement should summarize the model summary table release in English",
  );
  assert(
    !middlewareSource.includes("/api/system/update-announcement"),
    "middleware should not keep a public announcement API entry after announcements move into frontend code",
  );
  assert(
    !opsConfigSource.includes("公告类配置") &&
      !opsConfigSource.includes("multiline") &&
      !opsConfigSource.includes("<textarea"),
    "ops config page should not expose update announcement editing controls",
  );
  assert(
    !opsApiSource.includes("POLYWEATHER_UPDATE_ANNOUNCEMENT") &&
      !opsApiSource.includes("_RUNTIME_CONFIG_KEYS"),
    "ops API must not expose editable update announcement keys",
  );
  assert(
    !systemApiSource.includes("get_public_update_announcement") &&
      !systemRouterSource.includes("/api/system/update-announcement"),
    "backend must not expose a runtime update announcement endpoint",
  );
  assert(
    !dbSource.includes("CREATE TABLE IF NOT EXISTS runtime_config") &&
      !dbSource.includes("set_runtime_config") &&
      !dbSource.includes("get_runtime_config_value"),
    "database manager should not keep a runtime_config table only for update announcements",
  );
}
