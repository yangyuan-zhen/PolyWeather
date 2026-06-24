import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { BriefsIndexPageView } from "@/components/public-content/PublicContentPages";
import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_QUERY_PARAM,
  pickLandingLocale,
  type LandingLocale,
} from "@/components/landing/landingLocale";
import { PUBLIC_CONTENT_COPY } from "@/content/public-content";

type BriefsSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function resolvePublicContentLocale(searchParams: BriefsSearchParams): Promise<LandingLocale> {
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
  searchParams: BriefsSearchParams;
}): Promise<Metadata> {
  const locale = await resolvePublicContentLocale(searchParams);
  const copy = PUBLIC_CONTENT_COPY[locale];
  return {
    title: copy.briefIndexEyebrow,
    description: copy.briefIndexDescription,
    alternates: {
      canonical: "/briefs",
    },
    openGraph: {
      title: `Weather Market Brief | PolyWeather`,
      description: copy.briefIndexDescription,
      url: "/briefs",
    },
  };
}

export default async function BriefsPage({
  searchParams,
}: {
  searchParams: BriefsSearchParams;
}) {
  const locale = await resolvePublicContentLocale(searchParams);
  return <BriefsIndexPageView locale={locale} />;
}
