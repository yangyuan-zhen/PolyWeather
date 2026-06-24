export type LandingLocale = "zh-CN" | "en-US";

export const LANDING_LOCALE_COOKIE = "polyweather.locale";
export const LANDING_LOCALE_QUERY_PARAM = "locale";
export const DEFAULT_LANDING_LOCALE: LandingLocale = "zh-CN";

export function normalizeLandingLocale(value: string | null | undefined): LandingLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "zh" || normalized === "zh-cn" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }
  if (normalized === "en" || normalized === "en-us" || normalized.startsWith("en-")) {
    return "en-US";
  }
  return null;
}

export function pickLandingLocale(
  queryLocale: string | null | undefined,
  cookieLocale: string | null | undefined,
  acceptLanguage: string | null | undefined,
): LandingLocale {
  const fromQuery = normalizeLandingLocale(queryLocale);
  if (fromQuery) return fromQuery;

  const fromCookie = normalizeLandingLocale(cookieLocale);
  if (fromCookie) return fromCookie;

  for (const part of String(acceptLanguage || "").split(",")) {
    const locale = normalizeLandingLocale(part.split(";")[0]);
    if (locale) return locale;
  }

  return DEFAULT_LANDING_LOCALE;
}

export function nextLandingLocale(locale: LandingLocale): LandingLocale {
  return locale === "zh-CN" ? "en-US" : "zh-CN";
}

export function landingLocaleHref(pathname: string, locale: LandingLocale): string {
  const [pathWithQuery, hash] = pathname.split("#", 2);
  const separator = pathWithQuery.includes("?") ? "&" : "?";
  const localizedPath = `${pathWithQuery}${separator}${LANDING_LOCALE_QUERY_PARAM}=${encodeURIComponent(locale)}`;
  return hash ? `${localizedPath}#${hash}` : localizedPath;
}
