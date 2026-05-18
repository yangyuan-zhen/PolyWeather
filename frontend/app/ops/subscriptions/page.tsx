import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { SubscriptionsPageClient } from "@/components/ops/subscriptions/SubscriptionsPageClient";

export const metadata: Metadata = { title: "订阅操作 — PolyWeather Ops" };

export default async function SubscriptionsPage() {
  await requireOpsAdmin("/ops/subscriptions");
  return <SubscriptionsPageClient />;
}
