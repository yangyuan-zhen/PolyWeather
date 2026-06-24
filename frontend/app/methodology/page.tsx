import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { MethodologyIndexPageView } from "@/components/public-content/PublicContentPages";
import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_QUERY_PARAM,
  pickLandingLocale,
  type LandingLocale,
} from "@/components/landing/landingLocale";
import { PUBLIC_CONTENT_COPY } from "@/content/public-content";

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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: MethodologySearchParams;
}): Promise<Metadata> {
  const locale = await resolvePublicContentLocale(searchParams);
  const copy = PUBLIC_CONTENT_COPY[locale];
  return {
    title: copy.methodologyIndexEyebrow,
    description: copy.methodologyIndexDescription,
    alternates: {
      canonical: "/methodology",
    },
    openGraph: {
      title: `${copy.methodologyIndexEyebrow} | PolyWeather`,
      description: copy.methodologyIndexDescription,
      url: "/methodology",
    },
  };
}

export default async function MethodologyPage({
  searchParams,
}: {
  searchParams: MethodologySearchParams;
}) {
  const locale = await resolvePublicContentLocale(searchParams);
  return <MethodologyIndexPageView locale={locale} />;
}
