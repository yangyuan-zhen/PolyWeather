import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "PolyWeather | Weather Market Intelligence",
  description:
    "PolyWeather turns real-time weather observations and model spreads into settlement-focused probabilities, market scan signals, and Pro decision support.",
};

export default function HomePage() {
  return <LandingPage />;
}
