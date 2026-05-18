import { AdminShell } from "@/components/ops/layout/AdminShell";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
