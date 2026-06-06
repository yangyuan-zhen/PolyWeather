import { getDocsPage } from "@/content/docs/docs";
import { DOCS_PAGES } from "@/content/docs/docs";
import { DOCS_GROUPS } from "@/content/docs/docs.config";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pageText(slug: string, locale: "zh-CN" | "en-US") {
  const page = getDocsPage(slug);
  assert(page, `${slug} docs page should exist`);
  return [
    page.content[locale].title,
    page.content[locale].description,
    ...page.content[locale].sections.flatMap((section) => [
      section.title,
      ...section.blocks.flatMap((block) => {
        if (block.type === "paragraph" || block.type === "callout") return [block.text];
        if (block.type === "bullets" || block.type === "steps") return block.items;
        if (block.type === "link") return [block.label, block.caption || ""];
        if (block.type === "image") return [block.alt, block.caption || ""];
        return [];
      }),
    ]),
  ].join("\n");
}

export function runTests() {
  const publicDocSlugs = DOCS_PAGES.map((page) => page.slug);
  assert(
    publicDocSlugs.join(",") === "intro,chart-guide,realtime-sources,settlement-sources,extension",
    "public docs navigation should only expose current shipped user-facing surfaces",
  );
  for (const group of DOCS_GROUPS) {
    assert(
      DOCS_PAGES.some((page) => page.group === group.id),
      `docs navigation group should not be empty: ${group.id}`,
    );
  }

  const allDocsZh = publicDocSlugs.map((slug) => pageText(slug, "zh-CN")).join("\n");
  const allDocsEn = publicDocSlugs.map((slug) => pageText(slug, "en-US")).join("\n");
  for (const staleTerm of ["从地图进入", "机会榜", "日历", "EMOS", "LGBM", "城市决策卡", "付费判断台", "刷新锁"]) {
    assert(!allDocsZh.includes(staleTerm), `public Chinese docs should not expose stale term: ${staleTerm}`);
  }
  for (const staleTerm of ["map-launched", "opportunity board", "calendar", "EMOS", "LGBM", "city decision card", "paid decision workspace", "refresh lock"]) {
    assert(!allDocsEn.includes(staleTerm), `public English docs should not expose stale term: ${staleTerm}`);
  }

  const introZh = pageText("intro", "zh-CN");
  assert(
    introZh.includes("结算源优先") && introZh.includes("天气决策台"),
    "intro should position PolyWeather as a settlement-source-first decision terminal",
  );
  assert(
    introZh.includes("1-9 个图表槽位") && introZh.includes("天气决策 / 训练数据 / 使用指南"),
    "intro should match the current terminal navigation and chart-slot workflow",
  );

  const chartGuideZh = pageText("chart-guide", "zh-CN");
  assert(chartGuideZh.includes("如何读 PolyWeather 图表"), "chart guide title should be present");
  assert(chartGuideZh.includes("高级气象变量") && chartGuideZh.includes("默认隐藏"), "chart guide should explain advanced variables as hidden-by-default context");
  assert(chartGuideZh.includes("不要把概率温度带当成实测曲线"), "chart guide should warn against reading probability as observation");
  assert(chartGuideZh.includes("高温 / 全天"), "chart guide should document the current chart view modes");

  const realtimeSourcesZh = pageText("realtime-sources", "zh-CN");
  assert(realtimeSourcesZh.includes("AMSC 180s"), "realtime sources should document the AMSC 180s cadence");
  assert(realtimeSourcesZh.includes("AMOS 60s"), "realtime sources should document the AMOS 60s cadence");
  assert(realtimeSourcesZh.includes("SSE patch"), "realtime sources should document the SSE patch path");

  const settlementSourcesZh = pageText("settlement-sources", "zh-CN");
  assert(settlementSourcesZh.includes("结算站点"), "settlement source guide should exist");
  assert(settlementSourcesZh.includes("机场 METAR") && settlementSourcesZh.includes("官方结算站点"), "settlement source guide should distinguish airport and official station settlement");

  assert(
    getDocsPage("chart-guide")?.group === "getting-started" &&
      getDocsPage("realtime-sources")?.group === "settlement" &&
      getDocsPage("settlement-sources")?.group === "settlement",
    "docs navigation should expose chart, realtime source, and settlement source guides in the right groups",
  );

  const chartGuideEn = pageText("chart-guide", "en-US");
  assert(chartGuideEn.includes("How To Read PolyWeather Charts"), "English chart guide should exist");
  assert(chartGuideEn.includes("hidden by default"), "English chart guide should describe hidden-by-default advanced variables");
  assert(chartGuideEn.includes("Peak / All Day"), "English chart guide should document the current chart view modes");
}
