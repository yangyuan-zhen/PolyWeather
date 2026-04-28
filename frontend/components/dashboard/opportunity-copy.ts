import type { ScanOpportunityRow } from "@/lib/dashboard-types";

export function getLocalizedRowText(
  row: ScanOpportunityRow,
  locale: string,
  zh?: string | null,
  en?: string | null,
) {
  return locale === "en-US" ? en || zh || null : zh || en || null;
}
