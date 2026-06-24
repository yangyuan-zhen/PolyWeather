import type { Metadata } from "next";
import { SourcesIndexPageView } from "@/components/public-content/PublicContentPages";

export const metadata: Metadata = {
  title: "Weather Sources",
  description:
    "PolyWeather public source notes for MGM, METAR, HKO, NOAA, ECMWF, and settlement-source weather analysis.",
  alternates: {
    canonical: "/sources",
  },
  openGraph: {
    title: "Weather Sources | PolyWeather",
    description:
      "Public source notes for MGM, METAR, HKO, NOAA, ECMWF, and settlement-source weather analysis.",
    url: "/sources",
  },
};

export default function SourcesPage() {
  return <SourcesIndexPageView />;
}
