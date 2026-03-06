"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, Globe2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CityDetailPanel } from "@/components/city-detail-panel";
import { CityList } from "@/components/city-list";
import { MapView } from "@/components/map-view";
import { getCities, getCityDetail } from "@/lib/api";
import type { CityDetail, CitySummary } from "@/lib/types";

export function PolyWeatherDashboard() {
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="h-screen w-full p-3 md:p-4">
      <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-[280px_1fr_360px]">
        <section className="min-h-0">
          <CityList
            cities={orderedCities}
            selectedCity={selectedCity}
            onSelectCity={setSelectedCity}
          />
        </section>

        <section className="relative min-h-0">
          <div className="absolute left-3 right-3 top-3 z-[900] rounded-xl border border-slate-800 bg-slate-950/70 p-2 backdrop-blur md:left-4 md:right-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe2 className="h-4 w-4 text-cyan-300" />
                <h1 className="text-lg font-semibold uppercase tracking-wide text-cyan-100 md:text-xl">
                  PolyWeather
                </h1>
                <span className="hidden text-xs text-slate-400 md:inline">
                  Global Weather Risk Intelligence
                </span>
              </div>
              <Button size="sm" variant="secondary">
                <Bot className="mr-1 h-4 w-4" />
                Technical Guide
              </Button>
            </div>
          </div>
          <MapView
            cities={orderedCities}
            selectedCity={selectedCity}
            onSelectCity={setSelectedCity}
          />
        </section>

        <section className="min-h-0">
          <CityDetailPanel
            detail={selectedDetail}
            loading={loading}
            onRefresh={refreshCurrentCity}
          />
        </section>
      </div>

      {error ? (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[1200] -translate-x-1/2 rounded-lg border border-red-900 bg-red-950/90 px-3 py-2 text-sm text-red-100">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}
    </main>
  );
}
