import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";

export function normalizeLookupKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function getDetailForRow(
  row: Pick<ScanOpportunityRow, "city" | "city_display_name" | "display_name">,
  cityDetailsByName?: Record<string, CityDetail>,
) {
  if (!cityDetailsByName) return null;
  const rowKeys = [row.city, row.city_display_name, row.display_name]
    .map(normalizeLookupKey)
    .filter(Boolean);
  return (
    Object.entries(cityDetailsByName).find(([name, detail]) => {
      const detailKeys = [name, detail.name, detail.display_name]
        .map(normalizeLookupKey)
        .filter(Boolean);
      return rowKeys.some((key) => detailKeys.includes(key));
    })?.[1] || null
  );
}

export function getDetailViewDate(detail: CityDetail, row?: ScanOpportunityRow | null) {
  if (!row) return detail.local_date;
  const rawDate = row.selected_date || row.local_date || "";
  const phase = String(row.window_phase || "").toLowerCase();
  if ((phase === "tomorrow" || phase === "week_ahead") && rawDate) return rawDate;
  if (!rawDate || rawDate === detail.local_date || row.local_date === detail.local_date) {
    return detail.local_date;
  }
  return detail.local_date || rawDate;
}
