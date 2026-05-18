import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { ConfigPageClient } from "@/components/ops/config/ConfigPageClient";

export const metadata: Metadata = { title: "系统配置 — PolyWeather Ops" };

export default async function ConfigPage() {
  await requireOpsAdmin("/ops/config");
  return <ConfigPageClient />;
}
