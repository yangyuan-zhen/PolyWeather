import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { UsersPageClient } from "@/components/ops/users/UsersPageClient";

export const metadata: Metadata = { title: "用户积分 — PolyWeather Ops" };

export default async function UsersPage() {
  await requireOpsAdmin("/ops/users");
  return <UsersPageClient />;
}
