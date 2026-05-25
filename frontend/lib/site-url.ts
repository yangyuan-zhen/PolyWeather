export const PRODUCTION_SITE_URL = "https://polyweather.top";

export function getConfiguredSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? PRODUCTION_SITE_URL : "";
}
