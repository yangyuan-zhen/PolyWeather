import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const sidebar = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "layout", "AdminSidebar.tsx"),
    "utf8",
  );
  const opsApi = fs.readFileSync(path.join(projectRoot, "lib", "ops-api.ts"), "utf8");
  const pagePath = path.join(projectRoot, "app", "ops", "market-opportunities", "page.tsx");
  const proxyPath = path.join(projectRoot, "app", "api", "ops", "market-opportunities", "route.ts");
  const clientPath = path.join(
    projectRoot,
    "components",
    "ops",
    "market-opportunities",
    "MarketOpportunitiesPageClient.tsx",
  );

  assert(
    sidebar.includes("/ops/market-opportunities") && sidebar.includes("市场机会"),
    "ops sidebar must expose the internal market opportunities page",
  );
  assert(
    fs.existsSync(pagePath) && fs.readFileSync(pagePath, "utf8").includes("requireOpsAdmin"),
    "market opportunities page must exist and require ops admin access",
  );
  assert(
    fs.existsSync(proxyPath) &&
      fs.readFileSync(proxyPath, "utf8").includes("requireOpsProxyAuth") &&
      fs.readFileSync(proxyPath, "utf8").includes("/api/ops/market-opportunities"),
    "market opportunities proxy must stay ops-admin protected",
  );
  assert(
    opsApi.includes("marketOpportunities") &&
      opsApi.includes("/api/ops/market-opportunities"),
    "ops API client must expose market opportunities",
  );
  const client = fs.existsSync(clientPath) ? fs.readFileSync(clientPath, "utf8") : "";
  for (const column of [
    "城市",
    "选项",
    "方向",
    "买入价",
    "模型概率",
    "Edge",
    "市场链接",
  ]) {
    assert(client.includes(column), `market opportunities table must include ${column}`);
  }
  assert(
    client.includes("positive_edge_only") && client.includes("显示全部低价"),
    "market opportunities page must default to positive edge and allow showing every low-price option",
  );
  assert(
    client.includes("最高买入价") &&
      client.includes("最小 Edge") &&
      client.includes('showAllLowPrice ? "-1" : minEdge'),
    "market opportunities filters must label price versus edge and not edge-filter the show-all-low-price view",
  );
}
