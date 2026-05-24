export interface TerminalBilling {
  planAmount: number;
  pointsEnabled: boolean;
  pointsPerUsdc: number;
  maxDiscountUsdc: number;
  pointsUsed: number;
  discountAmount: number;
  payAmount: number;
  canRedeem: boolean;
}

export interface PointsRedemptionConfig {
  enabled?: boolean;
  points_per_usdc?: number;
  max_discount_usdc?: number;
}

export function computeBilling(params: {
  planPriceUsd: number;
  totalPoints: number;
  usePoints: boolean;
  redemptionCfg?: PointsRedemptionConfig | null;
}): TerminalBilling {
  const planAmount =
    Number.isFinite(params.planPriceUsd) && params.planPriceUsd > 0
      ? params.planPriceUsd
      : 10;

  const cfg = params.redemptionCfg || {};
  const pointsEnabled = cfg.enabled !== false;
  const pointsPerUsdcRaw = Number(cfg.points_per_usdc ?? 500);
  const pointsPerUsdc =
    Number.isFinite(pointsPerUsdcRaw) && pointsPerUsdcRaw > 0
      ? Math.floor(pointsPerUsdcRaw)
      : 500;

  const maxDiscountRaw = Number(cfg.max_discount_usdc ?? 3);
  const maxDiscountUsdc = Math.max(
    0,
    Math.min(
      Math.floor(Number.isFinite(maxDiscountRaw) ? maxDiscountRaw : 3),
      Math.floor(planAmount),
    ),
  );

  const maxRedeemablePoints = pointsPerUsdc * maxDiscountUsdc;
  const actualRedeem = pointsEnabled
    ? Math.min(params.totalPoints, maxRedeemablePoints)
    : 0;
  const discountUnits = Math.floor(actualRedeem / pointsPerUsdc);
  const pointsUsed = discountUnits * pointsPerUsdc;
  const canRedeem =
    pointsEnabled &&
    maxDiscountUsdc > 0 &&
    params.totalPoints >= pointsPerUsdc;
  const applyDiscount =
    params.usePoints && canRedeem && pointsUsed > 0;

  return {
    planAmount,
    pointsEnabled,
    pointsPerUsdc,
    maxDiscountUsdc,
    pointsUsed,
    discountAmount: discountUnits,
    payAmount: planAmount - (applyDiscount ? discountUnits : 0),
    canRedeem,
  };
}
