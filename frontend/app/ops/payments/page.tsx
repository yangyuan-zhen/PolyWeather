import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { PaymentsPageClient } from "@/components/ops/payments/PaymentsPageClient";

export const metadata: Metadata = { title: "支付管理 — PolyWeather Ops" };

export default async function PaymentsPage() {
  await requireOpsAdmin("/ops/payments");
  return <PaymentsPageClient />;
}
