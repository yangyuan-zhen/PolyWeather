import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { SystemPageClient } from "@/components/ops/system/SystemPageClient";

export const metadata: Metadata = {
  title: "系统状态 — PolyWeather Ops",
};

export default async function SystemPage() {
  const user = await requireOpsAdmin("/ops/system");
  return <SystemPageClient />;
}
