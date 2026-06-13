"use client";

import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_QUERY_PARAM,
  nextLandingLocale,
  type LandingLocale,
} from "@/components/landing/landingLocale";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function LandingLocaleToggle({ locale }: { locale: LandingLocale }) {
  const isEn = locale === "en-US";

  const toggleLocale = () => {
    const nextLocale = nextLandingLocale(locale);
    document.cookie = `${LANDING_LOCALE_COOKIE}=${nextLocale}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax`;
    document.documentElement.lang = nextLocale;
    try {
      window.localStorage.setItem(LANDING_LOCALE_COOKIE, nextLocale);
    } catch {
      // Locale persistence is best-effort; the cookie is enough for SSR.
    }

    const url = new URL(window.location.href);
    url.searchParams.set(LANDING_LOCALE_QUERY_PARAM, nextLocale);
    window.location.assign(url.toString());
  };

  return (
    <button
      type="button"
      onClick={toggleLocale}
      className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-1 text-xs font-semibold text-slate-500 shadow-sm hover:border-slate-300 disabled:cursor-wait disabled:opacity-70"
      aria-label={isEn ? "Switch language" : "切换语言"}
    >
      <span className={`rounded px-2 py-1 ${!isEn ? "bg-slate-900 text-white" : ""}`}>
        中
      </span>
      <span className={`rounded px-2 py-1 ${isEn ? "bg-slate-900 text-white" : ""}`}>
        EN
      </span>
    </button>
  );
}
