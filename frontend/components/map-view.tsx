"use client";

import dynamic from "next/dynamic";
import type { CitySummary } from "@/lib/types";

const DynamicMap = dynamic(
  () => import("@/components/map-canvas").then((m) => m.MapCanvas),
  { ssr: false },
);

type MapViewProps = {
  cities: CitySummary[];
  selectedCity: string | null;
  onSelectCity: (cityName: string) => void;
};

export function MapView(props: MapViewProps) {
  return (
    <div className="h-full w-full overflow-hidden rounded-2xl border border-slate-800">
      <DynamicMap {...props} />
    </div>
  );
}
