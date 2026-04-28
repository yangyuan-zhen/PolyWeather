"use client";

import { ModelForecast } from "@/components/dashboard/PanelSections";
import type { CityDetail } from "@/lib/dashboard-types";

export function ModelEvidencePanel({
  detail,
  isEn,
}: {
  detail: CityDetail;
  isEn: boolean;
}) {
  return (
    <section className="scan-ai-city-section models">
      <div className="scan-ai-city-section-title">
        {isEn ? "Evidence · multi-model support" : "证据 · 多模型支撑"}
      </div>
      <ModelForecast detail={detail} targetDate={detail.local_date} hideTitle />
    </section>
  );
}
