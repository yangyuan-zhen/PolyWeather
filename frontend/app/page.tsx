import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InstitutionalLandingPage } from "@/components/landing/InstitutionalLandingPage";

export const metadata: Metadata = {
  title: "PolyWeather | Institutional Weather Market Intelligence",
  description:
    "PolyWeather is a paid professional weather-market intelligence terminal with METAR evidence, DEB forecast blending, and AI decision cards.",
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = params.code;
  if (typeof code === "string" && code.trim()) {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null) {
        if (Array.isArray(value)) {
          for (const v of value) usp.append(key, v);
        } else {
          usp.set(key, value);
        }
      }
    }
    const qs = usp.toString();
    redirect(`/auth/callback${qs ? `?${qs}` : ""}`);
  }
  return <InstitutionalLandingPage />;
}
