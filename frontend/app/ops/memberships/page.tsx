import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { MembershipsPageClient } from "@/components/ops/memberships/MembershipsPageClient";

export const metadata: Metadata = { title: "会员订阅 — PolyWeather Ops" };

export default async function MembershipsPage() {
  await requireOpsAdmin("/ops/memberships");
  return <MembershipsPageClient />;
}
