import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { SourceDetailPageView } from "@/components/public-content/PublicContentPages";
import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_QUERY_PARAM,
  pickLandingLocale,
  type LandingLocale,
} from "@/components/landing/landingLocale";
import {
  SOURCE_PAGES,
  absolutePublicUrl,
  getSourcePage,
  localizeSourcePage,
  sourcePath,
} from "@/content/public-content";

type SourcePageParams = {
  slug: string;
};
type SourceSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function resolvePublicContentLocale(searchParams: SourceSearchParams): Promise<LandingLocale> {
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
  return SOURCE_PAGES.map((source) => ({ slug: source.slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<SourcePageParams>;
  searchParams: SourceSearchParams;
}): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([
    params,
    resolvePublicContentLocale(searchParams),
  ]);
  const source = getSourcePage(slug);

  if (!source) {
    return {
      title: "Source not found",
    };
  }
  const localizedSource = localizeSourcePage(source, locale);

  return {
    title: localizedSource.title,
    description: localizedSource.description,
    alternates: {
      canonical: sourcePath(source),
    },
    openGraph: {
      type: "article",
      title: localizedSource.title,
      description: localizedSource.description,
      url: sourcePath(source),
      modifiedTime: source.updatedAt,
    },
  };
}

export default async function SourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<SourcePageParams>;
  searchParams: SourceSearchParams;
}) {
  const [{ slug }, locale] = await Promise.all([
    params,
    resolvePublicContentLocale(searchParams),
  ]);
  const source = getSourcePage(slug);

  if (!source) {
    notFound();
  }

  const localizedSource = localizeSourcePage(source, locale);
  const pathname = sourcePath(source);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: localizedSource.title,
    description: localizedSource.description,
    url: absolutePublicUrl(pathname),
    dateModified: source.updatedAt,
    creator: {
      "@type": "Organization",
      name: source.operator,
    },
    includedInDataCatalog: {
      "@type": "DataCatalog",
      name: "PolyWeather source notes",
      url: absolutePublicUrl("/sources"),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SourceDetailPageView source={source} locale={locale} />
    </>
  );
}
