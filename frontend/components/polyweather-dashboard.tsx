"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Globe2,
  Languages,
  Radar,
  Signal,
  Waves,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CityDetailPanel } from "@/components/city-detail-panel";
import { CityList } from "@/components/city-list";
import { MapView } from "@/components/map-view";
import { getCities, getCityDetail } from "@/lib/api";
import { copy, type Locale } from "@/lib/i18n";
import type { CityDetail, CitySummary } from "@/lib/types";

export function PolyWeatherDashboard() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = copy[locale];

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setError(null);
        const data = await getCities();
        if (!mounted) return;
        setCities(data);
      } catch (err) {
        if (!mounted) return;
        setError(String(err));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedCity) return;
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const detail = await getCityDetail(selectedCity);
        if (!mounted) return;
        setSelectedDetail(detail);
      } catch (err) {
        if (!mounted) return;
        setError(String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedCity]);

  const orderedCities = useMemo(() => {
    const order = { high: 0, medium: 1, low: 2 };
    return [...cities].sort(
      (a, b) => (order[a.risk_level] ?? 99) - (order[b.risk_level] ?? 99),
    );
  }, [cities]);

  const riskStats = useMemo(() => {
    return {
      high: cities.filter((c) => c.risk_level === "high").length,
      medium: cities.filter((c) => c.risk_level === "medium").length,
      low: cities.filter((c) => c.risk_level === "low").length,
    };
  }, [cities]);

  async function refreshCurrentCity() {
    if (!selectedCity) return;
    setLoading(true);
    try {
      const detail = await getCityDetail(selectedCity, true);
      setSelectedDetail(detail);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function localizeError(raw: string) {
    if (raw.includes("POLYWEATHER_API_BASE_URL")) {
      return t.backendConfigMissing;
    }
    if (raw.toLowerCase().includes("failed to load cities")) {
      return `${t.loadCitiesFailed}: ${raw}`;
    }
    if (raw.toLowerCase().includes("failed to load city detail")) {
      return `${t.loadCityDetailFailed}: ${raw}`;
    }
    return raw;
  }

  return (
    <main className="h-screen w-full overflow-hidden p-2 md:p-4">
      <div className="grid h-full grid-cols-1 gap-3 lg:grid-cols-[290px_1fr_370px]">
        <section className="min-h-0 lg:block">
          <CityList
            cities={orderedCities}
            selectedCity={selectedCity}
            onSelectCity={setSelectedCity}
            locale={locale}
            text={{
              monitoredCities: t.monitoredCities,
              high: t.high,
              medium: t.medium,
              low: t.low,
              fahrenheit: t.fahrenheit,
              celsius: t.celsius,
            }}
          />
        </section>

        <section className="relative min-h-0">
          <div className="glass fade-up absolute left-2 right-2 top-2 z-[900] rounded-2xl border border-slate-700/80 p-2.5 md:left-4 md:right-4 md:top-4 md:p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Globe2 className="h-4 w-4 shrink-0 text-cyan-300" />
                <h1 className="shrink-0 text-base font-semibold uppercase tracking-[0.16em] text-cyan-100 md:text-lg">
                  PolyWeather
                </h1>
                <span className="hidden truncate text-xs text-slate-400 xl:inline">
                  {t.brandSubtitle}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-emerald-300 md:flex">
                  <Signal className="h-3 w-3" />
                  {t.live}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setLocale((v) => (v === "zh" ? "en" : "zh"))}
                >
                  <Languages className="mr-1 h-4 w-4" />
                  {locale === "zh" ? "EN" : "ZH"}
                </Button>
                <Button size="sm" variant="secondary">
                  <Bot className="mr-1 h-4 w-4" />
                  {t.technicalGuide}
                </Button>
              </div>
            </div>
          </div>

          <div className="absolute bottom-2 left-2 right-2 z-[900] md:bottom-4 md:left-4 md:right-auto">
            <div className="glass fade-up inline-flex flex-wrap items-center gap-2 rounded-xl border border-slate-700/80 p-2">
              <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-2.5 py-1 text-xs text-red-200">
                H {riskStats.high}
              </div>
              <div className="rounded-lg border border-amber-900/60 bg-amber-950/50 px-2.5 py-1 text-xs text-amber-200">
                M {riskStats.medium}
              </div>
              <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/50 px-2.5 py-1 text-xs text-emerald-200">
                L {riskStats.low}
              </div>
              <div className="hidden items-center gap-1 rounded-lg border border-cyan-900/60 bg-cyan-950/40 px-2.5 py-1 text-xs text-cyan-200 sm:flex">
                <Radar className="h-3.5 w-3.5" />
                {cities.length} {t.cities}
              </div>
              <div className="hidden items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 sm:flex">
                <Waves className="h-3.5 w-3.5" />
                AI + DEB
              </div>
            </div>
          </div>

          <MapView
            cities={orderedCities}
            selectedCity={selectedCity}
            onSelectCity={setSelectedCity}
          />
        </section>

        <section className="min-h-0 hidden lg:block">
          <CityDetailPanel
            detail={selectedDetail}
            loading={loading}
            onRefresh={refreshCurrentCity}
            locale={locale}
            text={{
              cityDetail: t.cityDetail,
              selectCityHint: t.selectCityHint,
              refresh: t.refresh,
              currentMax: t.currentMax,
              cloud: t.cloud,
              wind: t.wind,
              topProb: t.topProb,
              noProb: t.noProb,
              aiSummary: t.aiSummary,
              noAnalysis: t.noAnalysis,
            }}
          />
        </section>

        <section className="min-h-0 lg:hidden">
          <CityDetailPanel
            detail={selectedDetail}
            loading={loading}
            onRefresh={refreshCurrentCity}
            locale={locale}
            text={{
              cityDetail: t.cityDetail,
              selectCityHint: t.selectCityHint,
              refresh: t.refresh,
              currentMax: t.currentMax,
              cloud: t.cloud,
              wind: t.wind,
              topProb: t.topProb,
              noProb: t.noProb,
              aiSummary: t.aiSummary,
              noAnalysis: t.noAnalysis,
            }}
          />
        </section>
      </div>

      {error ? (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[1200] -translate-x-1/2 rounded-lg border border-red-900 bg-red-950/90 px-3 py-2 text-sm text-red-100">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{localizeError(error)}</span>
          </div>
        </div>
      ) : null}
    </main>
  );
}
