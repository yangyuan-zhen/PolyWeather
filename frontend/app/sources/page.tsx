import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { SourcesIndexPageView } from "@/components/public-content/PublicContentPages";
import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_QUERY_PARAM,
  pickLandingLocale,
  type LandingLocale,
} from "@/components/landing/landingLocale";
import { PUBLIC_CONTENT_COPY } from "@/content/public-content";

type SourcesSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function resolvePublicContentLocale(searchParams: SourcesSearchParams): Promise<LandingLocale> {
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SourcesSearchParams;
}): Promise<Metadata> {
  const locale = await resolvePublicContentLocale(searchParams);
  const copy = PUBLIC_CONTENT_COPY[locale];
  return {
    title: copy.sourceIndexEyebrow,
    description: copy.sourceIndexDescription,
    alternates: {
      canonical: "/sources",
    },
    openGraph: {
      title: `${copy.sourceIndexEyebrow} | PolyWeather`,
      description: copy.sourceIndexDescription,
      url: "/sources",
    },
  };
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: SourcesSearchParams;
}) {
  const locale = await resolvePublicContentLocale(searchParams);
  return <SourcesIndexPageView locale={locale} />;
}
