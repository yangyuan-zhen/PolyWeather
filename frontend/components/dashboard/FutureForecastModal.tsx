"use client";

import {
  useDashboardModal,
  useDashboardSelection,
  useProAccess,
} from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { FutureForecastModalContent } from "./FutureForecastModalContent";

export function FutureForecastModal() {
  const modal = useDashboardModal();
  const selection = useDashboardSelection();
  const proAccess = useProAccess();
  const { locale, t } = useI18n();
  const detail = selection.selectedDetail;
  const dateStr = modal.futureModalDate;

  if (!detail || !dateStr) return null;

  return (
    <FutureForecastModalContent
      modal={modal}
      proAccess={proAccess.proAccess}
      locale={locale}
      t={t}
      detail={detail}
      dateStr={dateStr}
    />
  );
}
