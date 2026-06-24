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
  const localeHelperPath = path.join(root, "components", "landing", "landingLocale.ts");
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
  const methodologyIndex = fs.readFileSync(methodologyIndexPath, "utf8");
  const methodologyDetail = fs.readFileSync(methodologyDetailPath, "utf8");
  const sourcesIndex = fs.readFileSync(sourcesIndexPath, "utf8");
  const sourceDetail = fs.readFileSync(sourceDetailPath, "utf8");
  const analytics = fs.readFileSync(analyticsPath, "utf8");
  const analyticsIsland = fs.readFileSync(analyticsIslandPath, "utf8");
  const publicPages = fs.readFileSync(publicPagesPath, "utf8");
  const localeHelper = fs.readFileSync(localeHelperPath, "utf8");
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
    content.includes("METHODOLOGY_PAGE_LOCALIZATIONS") &&
      content.includes("SOURCE_PAGE_LOCALIZATIONS") &&
      content.includes("DEB 不是结算预言机") &&
      content.includes("官方摘要可能滞后于原始点位观测"),
    "public methodology and source pages must provide Chinese body-level localization, not title-only translation",
  );
  assert(
    content.includes("24.5°C") &&
      content.includes("27.1°C") &&
      !/\b\d+(?:\.\d+)? C\b/.test(content),
    "public brief temperatures must use the degree Celsius symbol instead of a bare C",
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
    localeHelper.includes("export function landingLocaleHref") &&
      localeHelper.includes("LANDING_LOCALE_QUERY_PARAM"),
    "landing locale helpers must expose a shared href builder for explicit locale navigation",
  );
  assert(
    publicPages.includes("landingLocaleHref") &&
      publicPages.includes('href={landingLocaleHref("/briefs", locale)}') &&
      publicPages.includes("href={landingLocaleHref(briefPath(brief), locale)}") &&
      publicPages.includes("href={landingLocaleHref(methodologyPath(localizedPage), locale)}") &&
      publicPages.includes("href={landingLocaleHref(sourcePath(localizedSource), locale)}"),
    "public content brief cards, nav, methodology, and source links must preserve the current locale",
  );
  assert(
    methodologyIndex.includes("resolvePublicContentLocale(searchParams)") &&
      methodologyIndex.includes("<MethodologyIndexPageView locale={locale} />") &&
      methodologyDetail.includes("resolvePublicContentLocale(searchParams)") &&
      methodologyDetail.includes("<MethodologyDetailPageView page={page} locale={locale} />") &&
      sourcesIndex.includes("resolvePublicContentLocale(searchParams)") &&
      sourcesIndex.includes("<SourcesIndexPageView locale={locale} />") &&
      sourceDetail.includes("resolvePublicContentLocale(searchParams)") &&
      sourceDetail.includes("<SourceDetailPageView source={source} locale={locale} />"),
    "methodology and source public routes must resolve and pass the same locale as brief routes",
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
