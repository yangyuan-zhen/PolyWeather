import type { ScanOpportunityRow } from "@/lib/dashboard-types";

export function rowName(row?: ScanOpportunityRow | null) {
  return row?.city_display_name || row?.display_name || row?.city || "--";
}

export function pct(value: unknown, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(digits)}%`;
}

export function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `$${Math.round(n).toLocaleString()}`;
}

export function temp(value: unknown, unit?: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${n.toFixed(1)}${unit || "°"}`;
}

export function edgeClass(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "text-slate-500";
  return n > 0 ? "text-emerald-600" : "text-rose-600";
}
