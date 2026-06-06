import { getDocsPage } from "@/content/docs/docs";

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
  const introZh = pageText("intro", "zh-CN");
  assert(
    introZh.includes("结算源优先") && introZh.includes("实时实测终端"),
    "intro should position PolyWeather as a settlement-source-first live terminal",
  );

  const chartGuideZh = pageText("chart-guide", "zh-CN");
  assert(chartGuideZh.includes("如何读 PolyWeather 图表"), "chart guide title should be present");
  assert(chartGuideZh.includes("高级气象变量") && chartGuideZh.includes("默认隐藏"), "chart guide should explain advanced variables as hidden-by-default context");
  assert(chartGuideZh.includes("不要把概率温度带当成实测曲线"), "chart guide should warn against reading probability as observation");

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
}
