"use client";

import { AlertTriangle, GaugeCircle, ShieldCheck, ThermometerSun } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CitySummary } from "@/lib/types";

type CityListProps = {
  cities: CitySummary[];
  selectedCity: string | null;
  onSelectCity: (cityName: string) => void;
  locale: Locale;
  text: {
    monitoredCities: string;
    high: string;
    medium: string;
    low: string;
    fahrenheit: string;
    celsius: string;
  };
};

function riskVariant(level: CitySummary["risk_level"]): "success" | "warning" | "danger" {
  if (level === "high") return "danger";
  if (level === "medium") return "warning";
  return "success";
}

export function CityList({
  cities,
  selectedCity,
  onSelectCity,
  locale,
  text,
}: CityListProps) {
  const high = cities.filter((c) => c.risk_level === "high").length;
  const medium = cities.filter((c) => c.risk_level === "medium").length;
  const low = cities.filter((c) => c.risk_level === "low").length;

  return (
    <Card className="glass h-full overflow-hidden">
      <CardHeader className="space-y-3 pb-3">
        <CardTitle className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-300">
          <span className={locale === "zh" ? "tracking-[0.08em]" : ""}>
            {text.monitoredCities}
          </span>
          <Badge variant="default">{cities.length}</Badge>
        </CardTitle>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-lg border border-red-900/70 bg-red-950/40 p-2 text-red-200">
            <div className="mb-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              <span>{text.high}</span>
            </div>
            <p className="text-base font-semibold">{high}</p>
          </div>
          <div className="rounded-lg border border-amber-900/70 bg-amber-950/40 p-2 text-amber-200">
            <div className="mb-1 flex items-center gap-1">
              <GaugeCircle className="h-3 w-3" />
              <span>{text.medium}</span>
            </div>
            <p className="text-base font-semibold">{medium}</p>
          </div>
          <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 p-2 text-emerald-200">
            <div className="mb-1 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              <span>{text.low}</span>
            </div>
            <p className="text-base font-semibold">{low}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="h-[calc(100%-128px)] overflow-y-auto pb-3">
        <div className="space-y-1.5">
          {cities.map((city) => (
            <button
              key={city.name}
              onClick={() => onSelectCity(city.name)}
              className={cn(
                "w-full rounded-xl border px-3 py-2 text-left transition-all",
                selectedCity === city.name
                  ? "translate-x-1 border-cyan-400/60 bg-cyan-950/40 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.28)]"
                  : "border-slate-800/90 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-800/80",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-semibold text-slate-100">
                  {city.display_name}
                </div>
                <Badge variant={riskVariant(city.risk_level)}>{city.risk_level}</Badge>
              </div>
              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
                <ThermometerSun className="h-3.5 w-3.5" />
                <span>
                  {city.temp_unit === "fahrenheit"
                    ? text.fahrenheit
                    : text.celsius}
                </span>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
