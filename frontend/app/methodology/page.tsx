import type { Metadata } from "next";
import { MethodologyIndexPageView } from "@/components/public-content/PublicContentPages";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "PolyWeather public methodology for DEB forecast blending, settlement-source priority, freshness, and market weather analysis.",
  alternates: {
    canonical: "/methodology",
  },
  openGraph: {
    title: "Methodology | PolyWeather",
    description:
      "Public methodology for DEB forecast blending, settlement-source priority, freshness, and market weather analysis.",
    url: "/methodology",
  },
};

export default function MethodologyPage() {
  return <MethodologyIndexPageView />;
}
