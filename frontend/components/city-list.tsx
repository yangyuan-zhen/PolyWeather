"use client";

import { ThermometerSun } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CitySummary } from "@/lib/types";

type CityListProps = {
  cities: CitySummary[];
  selectedCity: string | null;
  onSelectCity: (cityName: string) => void;
};

function riskVariant(level: CitySummary["risk_level"]): "success" | "warning" | "danger" {
  if (level === "high") return "danger";
  if (level === "medium") return "warning";
  return "success";
}

export function CityList({ cities, selectedCity, onSelectCity }: CityListProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm uppercase tracking-wider text-slate-300">
          <span>Monitored Cities</span>
          <Badge variant="default">{cities.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-64px)] overflow-y-auto">
        <div className="space-y-2">
          {cities.map((city) => (
            <button
              key={city.name}
              onClick={() => onSelectCity(city.name)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                selectedCity === city.name
                  ? "border-cyan-500 bg-cyan-950/40"
                  : "border-slate-800 bg-slate-900/70 hover:bg-slate-800/80",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate font-medium text-slate-100">
                  {city.display_name}
                </div>
                <Badge variant={riskVariant(city.risk_level)}>{city.risk_level}</Badge>
              </div>
              <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                <ThermometerSun className="h-3.5 w-3.5" />
                <span>{city.temp_unit === "fahrenheit" ? "Fahrenheit" : "Celsius"}</span>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
