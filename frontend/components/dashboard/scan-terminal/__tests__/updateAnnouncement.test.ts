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
  assert(fs.existsSync(nextRoutePath), "frontend must proxy the public update announcement API");

  const componentSource = fs.readFileSync(componentPath, "utf8");
  const routeSource = fs.readFileSync(nextRoutePath, "utf8");

  assert(
    dashboardSource.includes("UpdateAnnouncementButton") &&
      dashboardSource.includes("<UpdateAnnouncementButton") &&
      dashboardSource.includes("isEn={isEn}"),
    "terminal header must render a bilingual update announcement entry beside the dashboard title",
  );
  assert(
    componentSource.includes("/api/system/update-announcement") &&
      componentSource.includes("Megaphone") &&
      componentSource.includes("zh") &&
      componentSource.includes("en") &&
      !componentSource.includes("setInterval("),
    "announcement component must fetch the public announcement once, support zh/en content, and avoid aggressive polling",
  );
  assert(
    routeSource.includes(`${"api/system/update-announcement"}`) &&
      routeSource.includes("cache: \"no-store\""),
    "Next.js announcement proxy must call the backend public endpoint without caching stale admin content",
  );
  assert(
    middlewareSource.includes('pathname === "/api/system/update-announcement"'),
    "update announcement proxy must stay public because it only returns non-sensitive release notes",
  );
  assert(
    opsConfigSource.includes("multiline") &&
      opsConfigSource.includes("<textarea") &&
      opsConfigSource.includes("DB 持久化"),
    "ops config page must support persistent multiline announcement fields",
  );
  assert(
    opsApiSource.includes("POLYWEATHER_UPDATE_ANNOUNCEMENT_TITLE_ZH") &&
      opsApiSource.includes("POLYWEATHER_UPDATE_ANNOUNCEMENT_BODY_EN") &&
      opsApiSource.includes("_RUNTIME_CONFIG_KEYS"),
    "ops API must expose editable zh/en announcement keys through the runtime config store",
  );
  assert(
    systemApiSource.includes("get_public_update_announcement") &&
      systemRouterSource.includes("/api/system/update-announcement"),
    "backend must expose a public read-only update announcement endpoint",
  );
  assert(
    dbSource.includes("CREATE TABLE IF NOT EXISTS runtime_config") &&
      dbSource.includes("set_runtime_config") &&
      dbSource.includes("get_runtime_config_value"),
    "database manager must persist non-sensitive runtime config independently from runtime secrets",
  );
}
