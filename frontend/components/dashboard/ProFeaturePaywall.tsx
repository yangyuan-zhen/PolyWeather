"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { UnlockProOverlay } from "@/components/subscription/UnlockProOverlay";
import { trackAppEvent } from "@/lib/app-analytics";

const TELEGRAM_GROUP_URL = String(
  process.env.NEXT_PUBLIC_TELEGRAM_GROUP_URL ||
    "https://t.me/+nMG7SjziUKYyZmM1",
).trim();
const SUBSCRIPTION_HELP_HREF = "/subscription-help";

type ProFeaturePaywallProps = {
  feature: "today" | "history" | "future";
  onClose?: () => void;
};

export function ProFeaturePaywall({
  feature,
  onClose,
}: ProFeaturePaywallProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const { proAccess } = useDashboardStore();
  const [usePoints, setUsePoints] = useState(true);

  const isEn = locale === "en-US";
  const isAuthenticated = proAccess.authenticated;
  const pointsAvailable = Number(proAccess.points || 0);

  const PRO_PRICE_USD = 5;
  const POINTS_PER_USD = 500;
  const MAX_DISCOUNT_USD = 3;

  const billing = useMemo(() => {
    const isEligible = pointsAvailable >= POINTS_PER_USD;
    const maxRedeemablePoints = MAX_DISCOUNT_USD * POINTS_PER_USD;
    const boundedPoints = isEligible
      ? Math.min(pointsAvailable, maxRedeemablePoints)
      : 0;
    const discountUnits = Math.floor(boundedPoints / POINTS_PER_USD);
    const pointsUsed = discountUnits * POINTS_PER_USD;
    const discountAmount = usePoints ? discountUnits : 0;

    return {
      pointsEnabled: true,
      isEligible,
      pointsPerUsd: POINTS_PER_USD,
      maxDiscountUsd: MAX_DISCOUNT_USD,
      pointsUsed: usePoints ? pointsUsed : 0,
      discountAmount,
      finalPrice: PRO_PRICE_USD - discountAmount,
    };
  }, [pointsAvailable, usePoints]);

  const payLabel = isAuthenticated
    ? isEn
      ? "Open Pro in Account"
      : "去账户中心开通 Pro"
    : isEn
      ? "Sign In to Unlock Pro"
      : "先登录再开通 Pro";

  useEffect(() => {
    trackAppEvent("paywall_viewed", {
      entry: "feature_gate",
      feature,
      user_state: isAuthenticated ? "logged_in" : "guest",
    });
  }, [feature, isAuthenticated]);

  return (
    <div className="flex w-full flex-col items-center justify-center py-6 md:py-10 z-30 p-4">
      <UnlockProOverlay
        locale={locale}
        points={pointsAvailable}
        planPriceUsd={PRO_PRICE_USD}
        usePoints={usePoints}
        onToggleUsePoints={() => setUsePoints((prev) => !prev)}
        billing={billing}
        onClose={onClose}
        onPay={() => {
          if (!isAuthenticated) {
            router.push("/auth/login?next=%2Faccount");
            return;
          }
          router.push("/account");
        }}
        payLabel={payLabel}
        faqHref={SUBSCRIPTION_HELP_HREF}
        telegramGroupUrl={TELEGRAM_GROUP_URL}
      />
    </div>
  );
}
