import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { BriefDetailPageView } from "@/components/public-content/PublicContentPages";
import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_QUERY_PARAM,
  pickLandingLocale,
  type LandingLocale,
} from "@/components/landing/landingLocale";
import {
  PUBLIC_BRIEFS,
  absolutePublicUrl,
  briefPath,
  getBrief,
  localizeBrief,
} from "@/content/public-content";

type BriefPageParams = {
  city: string;
  date: string;
};
type BriefSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function resolvePublicContentLocale(searchParams: BriefSearchParams): Promise<LandingLocale> {
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
  return PUBLIC_BRIEFS.map((brief) => ({
    city: brief.city,
    date: brief.date,
  }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<BriefPageParams>;
  searchParams: BriefSearchParams;
}): Promise<Metadata> {
  const [{ city, date }, locale] = await Promise.all([
    params,
    resolvePublicContentLocale(searchParams),
  ]);
  const brief = getBrief(city, date);

  if (!brief) {
    return {
      title: "Brief not found",
    };
  }

  const localizedBrief = localizeBrief(brief, locale);
  const pathname = briefPath(localizedBrief);

  return {
    title: localizedBrief.title,
    description: localizedBrief.description,
    alternates: {
      canonical: pathname,
    },
    openGraph: {
      type: "article",
      title: localizedBrief.title,
      description: localizedBrief.description,
      url: pathname,
      publishedTime: localizedBrief.publishedAt,
      modifiedTime: localizedBrief.updatedAt,
    },
    twitter: {
      card: "summary",
      title: localizedBrief.title,
      description: localizedBrief.description,
    },
  };
}

export default async function BriefDetailPage({
  params,
  searchParams,
}: {
  params: Promise<BriefPageParams>;
  searchParams: BriefSearchParams;
}) {
  const [{ city, date }, locale] = await Promise.all([
    params,
    resolvePublicContentLocale(searchParams),
  ]);
  const brief = getBrief(city, date);

  if (!brief) {
    notFound();
  }

  const localizedBrief = localizeBrief(brief, locale);
  const pathname = briefPath(localizedBrief);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: localizedBrief.title,
      description: localizedBrief.description,
      datePublished: localizedBrief.publishedAt,
      dateModified: localizedBrief.updatedAt,
      mainEntityOfPage: absolutePublicUrl(pathname),
      author: {
        "@type": "Organization",
        name: "PolyWeather",
        url: "https://polyweather.top",
      },
      publisher: {
        "@type": "Organization",
        name: "PolyWeather",
        url: "https://polyweather.top",
      },
      about: [
        localizedBrief.cityName,
        localizedBrief.market,
        localizedBrief.settlementSource,
        "DEB forecast methodology",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Briefs",
          item: absolutePublicUrl("/briefs"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: localizedBrief.cityName,
          item: absolutePublicUrl(pathname),
        },
      ],
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <BriefDetailPageView brief={brief} locale={locale} />
    </>
  );
}
