import type { CityDetail } from "@/lib/dashboard-types";

export function getDisplayAirportPrimary(detail?: CityDetail | null) {
  return detail?.airport_primary ?? undefined;
}
