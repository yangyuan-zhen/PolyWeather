import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { MethodologyDetailPageView } from "@/components/public-content/PublicContentPages";
import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_QUERY_PARAM,
  pickLandingLocale,
  type LandingLocale,
} from "@/components/landing/landingLocale";
import {
  METHODOLOGY_PAGES,
  absolutePublicUrl,
  getMethodologyPage,
  localizeMethodologyPage,
  methodologyPath,
} from "@/content/public-content";

type MethodologyPageParams = {
  slug: string;
};
type MethodologySearchParams = Promise<Record<string, string | string[] | undefined>>;

async function resolvePublicContentLocale(searchParams: MethodologySearchParams): Promise<LandingLocale> {
  const params = await searchParams;
  const rawLocale = params[LANDING_LOCALE_QUERY_PARAM];
  const queryLocale = Array.isArray(rawLocale) ? rawLocale[0] : rawLocale;
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return pickLandingLocale(
    queryLocale,
    cookieStore.get(LANDING_LOCALE_COOKIE)?.value,
    headerStore.get("accept-language"),
  );
}

export function generateStaticParams() {
  return METHODOLOGY_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<MethodologyPageParams>;
  searchParams: MethodologySearchParams;
}): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([
    params,
    resolvePublicContentLocale(searchParams),
  ]);
  const page = getMethodologyPage(slug);

  if (!page) {
    return {
      title: "Methodology not found",
    };
  }
  const localizedPage = localizeMethodologyPage(page, locale);

  return {
    title: localizedPage.title,
    description: localizedPage.description,
    alternates: {
      canonical: methodologyPath(page),
    },
    openGraph: {
      type: "article",
      title: localizedPage.title,
      description: localizedPage.description,
      url: methodologyPath(page),
      modifiedTime: page.updatedAt,
    },
  };
}

export default async function MethodologyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<MethodologyPageParams>;
  searchParams: MethodologySearchParams;
}) {
  const [{ slug }, locale] = await Promise.all([
    params,
    resolvePublicContentLocale(searchParams),
  ]);
  const page = getMethodologyPage(slug);

  if (!page) {
    notFound();
  }

  const localizedPage = localizeMethodologyPage(page, locale);
  const pathname = methodologyPath(page);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: localizedPage.title,
    description: localizedPage.description,
    dateModified: page.updatedAt,
    mainEntityOfPage: absolutePublicUrl(pathname),
    author: {
      "@type": "Organization",
      name: "PolyWeather",
      url: "https://polyweather.top",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MethodologyDetailPageView page={page} locale={locale} />
    </>
  );
}
