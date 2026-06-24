import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const root = process.cwd();
  const contentPath = path.join(root, "content", "public-content.ts");
  const briefsIndexPath = path.join(root, "app", "briefs", "page.tsx");
  const briefDetailPath = path.join(root, "app", "briefs", "[city]", "[date]", "page.tsx");
  const methodologyIndexPath = path.join(root, "app", "methodology", "page.tsx");
  const methodologyDetailPath = path.join(root, "app", "methodology", "[slug]", "page.tsx");
  const sourcesIndexPath = path.join(root, "app", "sources", "page.tsx");
  const sourceDetailPath = path.join(root, "app", "sources", "[slug]", "page.tsx");
  const analyticsPath = path.join(root, "lib", "app-analytics.ts");
  const analyticsIslandPath = path.join(root, "components", "public-content", "PublicContentAnalytics.tsx");
  const publicPagesPath = path.join(root, "components", "public-content", "PublicContentPages.tsx");
  const sitemapPath = path.join(root, "app", "sitemap.ts");

  for (const requiredPath of [
    contentPath,
    briefsIndexPath,
    briefDetailPath,
    methodologyIndexPath,
    methodologyDetailPath,
    sourcesIndexPath,
      sourceDetailPath,
      analyticsIslandPath,
      publicPagesPath,
    ]) {
    assert(fs.existsSync(requiredPath), `${path.relative(root, requiredPath)} must exist`);
  }

  const content = fs.readFileSync(contentPath, "utf8");
  const briefDetail = fs.readFileSync(briefDetailPath, "utf8");
  const methodologyDetail = fs.readFileSync(methodologyDetailPath, "utf8");
  const sourceDetail = fs.readFileSync(sourceDetailPath, "utf8");
  const analytics = fs.readFileSync(analyticsPath, "utf8");
  const analyticsIsland = fs.readFileSync(analyticsIslandPath, "utf8");
  const publicPages = fs.readFileSync(publicPagesPath, "utf8");
  const sitemap = fs.readFileSync(sitemapPath, "utf8");
  const briefsIndex = fs.readFileSync(briefsIndexPath, "utf8");

  assert(
    content.includes("PUBLIC_BRIEFS") &&
      content.includes("METHODOLOGY_PAGES") &&
      content.includes("SOURCE_PAGES") &&
      content.includes('"ankara"') &&
      content.includes('"deb"') &&
      content.includes('"mgm"'),
    "public content module must define sample briefs plus DEB and MGM public pages",
  );
  assert(
    content.includes("notFinancialAdvice") &&
      content.includes("updatedAt") &&
      content.includes("settlementSource") &&
      content.includes("distributionText"),
    "public briefs must carry disclaimer, freshness, settlement source, and shareable distribution copy",
  );
  assert(
    content.includes("PUBLIC_CONTENT_COPY") &&
      content.includes('"zh-CN"') &&
      content.includes('"en-US"') &&
      content.includes("公开天气市场简报") &&
      content.includes("安卡拉") &&
      content.includes("阅读简报"),
    "public brief content must provide Chinese and English localized copy",
  );
  assert(
    briefDetail.includes("generateStaticParams") &&
      briefDetail.includes("generateMetadata") &&
      briefDetail.includes("application/ld+json") &&
      briefDetail.includes("BreadcrumbList") &&
      briefDetail.includes("Article") &&
      briefDetail.includes("notFound()"),
    "brief detail route must be statically indexable with metadata, JSON-LD, breadcrumbs, and 404 handling",
  );
  assert(
    methodologyDetail.includes("generateStaticParams") &&
      methodologyDetail.includes("TechArticle") &&
      methodologyDetail.includes("application/ld+json") &&
      sourceDetail.includes("Dataset") &&
      sourceDetail.includes("application/ld+json"),
    "methodology and source detail routes must expose structured data for GEO/SEO",
  );
  assert(
    publicPages.includes('MethodologyLinks locale={locale} slugs={["deb", "settlement-sources"]}') &&
      publicPages.includes('SourceLinks locale={locale} slugs={["mgm", "metar", "hko", "noaa"]}') &&
      briefsIndex.includes("Weather Market Brief"),
    "brief index must cross-link to DEB methodology and settlement source pages",
  );
  assert(
    publicPages.includes("LandingLocaleToggle") &&
      publicPages.includes("localizeBrief") &&
      publicPages.includes("PUBLIC_CONTENT_COPY") &&
      publicPages.includes('locale === "en-US" ? "Briefs" : "简报"'),
    "public content pages must render the shared language toggle and localized brief copy",
  );
  assert(
    analytics.includes('"brief_view"') &&
      analytics.includes('"brief_cta_click"') &&
      analytics.includes('"methodology_view"') &&
      analytics.includes('"social_outbound_click"'),
    "analytics event union must include public content acquisition events",
  );
  assert(
    analyticsIsland.startsWith('"use client"') &&
      analyticsIsland.includes("trackAppEvent") &&
      analyticsIsland.includes("brief_view") &&
      analyticsIsland.includes("brief_cta_click") &&
      analyticsIsland.includes("methodology_view") &&
      analyticsIsland.includes("social_outbound_click"),
    "public content analytics must be isolated in a client island and emit the new events",
  );
  assert(
    sitemap.includes("PUBLIC_BRIEFS") &&
      sitemap.includes("METHODOLOGY_PAGES") &&
      sitemap.includes("SOURCE_PAGES") &&
      sitemap.includes("/briefs") &&
      sitemap.includes("/methodology/") &&
      sitemap.includes("/sources/"),
    "sitemap must enumerate public content assets for search and answer engines",
  );
}
