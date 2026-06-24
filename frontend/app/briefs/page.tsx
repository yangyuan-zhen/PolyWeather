import type { Metadata } from "next";
import { BriefsIndexPageView } from "@/components/public-content/PublicContentPages";

export const metadata: Metadata = {
  title: "Weather Market Brief",
  description:
    "Public PolyWeather market briefs for temperature judgment, settlement-source checks, DEB context, and source freshness notes.",
  alternates: {
    canonical: "/briefs",
  },
  openGraph: {
    title: "Weather Market Brief | PolyWeather",
    description:
      "Public market briefs for temperature judgment, settlement-source checks, DEB context, and source freshness notes.",
    url: "/briefs",
  },
};

export default function BriefsPage() {
  return <BriefsIndexPageView />;
}
