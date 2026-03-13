"use client";

import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Coins,
  Crown,
  ExternalLink,
  Loader2,
  Lock,
  MessageSquare,
  Radar,
  Send,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import s from "./UnlockProOverlay.module.css";

export type UnlockProBilling = {
  pointsEnabled: boolean;
  isEligible: boolean;
  pointsUsed: number;
  discountAmount: number;
  finalPrice: number;
  maxDiscountUsd: number;
  pointsPerUsd: number;
};

type UnlockProOverlayProps = {
  points: number;
  planPriceUsd: number;
  usePoints: boolean;
  billing: UnlockProBilling;
  onToggleUsePoints: () => void;
  onPay: () => void;
  onClose?: () => void;
  payBusy?: boolean;
  payLabel?: string;
  locale?: "zh-CN" | "en-US";
  errorText?: string;
  infoText?: string;
  faqHref?: string;
  telegramGroupUrl?: string;
  txHash?: string;
  chainId?: number;
  paymentTokenLabel?: string;
};

const FEATURES = {
  "zh-CN": [
    "今日日内深度分析（含高温时段）",
    "历史对账 + 未来日期分析",
    "全平台智能气象推送",
  ],
  "en-US": [
    "Intraday deep analysis with peak-time window",
    "Historical reconciliation + future-date analysis",
    "Cross-platform alerts",
  ],
};

export function UnlockProOverlay({
  points,
  planPriceUsd,
  usePoints,
  billing,
  onToggleUsePoints,
  onPay,
  onClose,
  payBusy = false,
  payLabel,
  locale = "zh-CN",
  errorText,
  infoText,
  faqHref = "/account",
  telegramGroupUrl,
  txHash,
  chainId = 137,
  paymentTokenLabel,
}: UnlockProOverlayProps) {
  const isEn = locale === "en-US";
  const canUsePoints = billing.pointsEnabled && billing.isEligible;
  const featureList = FEATURES[locale] ?? FEATURES["zh-CN"];
  const finalPayLabel =
    payLabel || (isEn ? "Subscribe & Activate" : "立即订阅并激活服务");

  const maxDiscountUsdInt = Math.max(1, Math.floor(billing.maxDiscountUsd || 0));
  const maxPointsForFullDiscount = Math.max(
    billing.pointsPerUsd,
    billing.pointsPerUsd * maxDiscountUsdInt,
  );
  const redeemableUsdNow = billing.pointsEnabled
    ? Math.min(maxDiscountUsdInt, Math.floor(points / Math.max(1, billing.pointsPerUsd)))
    : 0;
  const progressPct = billing.pointsEnabled
    ? Math.min(100, Math.round((points / maxPointsForFullDiscount) * 100))
    : 0;
  const txHref =
    txHash && txHash.startsWith("0x")
      ? `${chainId === 137 ? "https://polygonscan.com" : "https://etherscan.io"}/tx/${txHash}`
      : "";

  return (
    <div className={s.modal}>
      {/* Ambient glows */}
      <div className={s.glowLeft} />
      <div className={s.glowRight} />
      <div className={s.topLine} />

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className={s.closeBtn}
          title={isEn ? "Close" : "关闭"}
        >
          <X size={15} />
        </button>
      )}

      {/* ── Header ── */}
      <div className={s.header}>
        <div className={s.badge}>
          <Crown size={12} style={{ color: "#fbbf24" }} />
          <span className={s.badgeText}>Pro</span>
        </div>
        <h2 className={s.title}>
          {isEn ? "Unlock PolyWeather Pro" : "解锁 PolyWeather Pro"}
        </h2>
        <p className={s.subtitle}>
          {isEn
            ? "High-precision weather intelligence, delivered everywhere."
            : "全球最精准的高精度气象推送，全平台覆盖"}
        </p>
      </div>

      {/* ── Cards ── */}
      <div className={s.grid}>
        {/* Left: Plan card */}
        <div className={s.planCard}>
          <span className={s.planChip}>
            <Zap size={10} />
            Standard Pro
          </span>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 4,
              marginTop: 12,
            }}
          >
            <span className={s.price}>${planPriceUsd.toFixed(2)}</span>
            <span className={s.priceSuffix}>/ {isEn ? "mo" : "月"}</span>
          </div>

          <ul className={s.featureList}>
            {featureList.map((item, i) => (
              <li key={i} className={s.featureItem}>
                <span className={s.featureIcon}>
                  <CheckCircle2 size={11} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: Points card */}
        {canUsePoints ? (
          <div
            className={`${s.pointsCard} ${usePoints ? s.pointsCardActive : ""}`}
          >
            {/* Header row */}
            <div className={s.pointsHeader}>
              <div className={s.pointsLabelRow}>
                <div
                  className={`${s.pointsIconBox} ${usePoints ? s.pointsIconBoxActive : ""}`}
                >
                  <Coins size={13} />
                </div>
                <span
                  className={`${s.pointsLabel} ${usePoints ? s.pointsLabelActive : ""}`}
                >
                  {isEn ? "Points Credit" : "积分抵扣"}
                </span>
              </div>
              <button
                onClick={onToggleUsePoints}
                className={`${s.toggle} ${usePoints ? s.toggleActive : ""}`}
                title={isEn ? "Toggle points" : "切换积分"}
              >
                <div
                  className={`${s.toggleThumb} ${usePoints ? s.toggleThumbActive : ""}`}
                />
              </button>
            </div>

            {/* Discount amount */}
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span
                className={`${s.discount} ${usePoints ? s.discountActive : ""}`}
              >
                -${billing.discountAmount.toFixed(2)}
              </span>
              <span className={s.discountSuffix}>off</span>
            </div>

            <p className={s.pointsNote}>
              {usePoints
                ? isEn
                  ? `Using ${billing.pointsUsed} pts · saves $${billing.discountAmount.toFixed(2)}`
                  : `已消耗 ${billing.pointsUsed} 积分 · 省 $${billing.discountAmount.toFixed(2)}`
                : isEn
                  ? `Toggle to save up to $${billing.maxDiscountUsd.toFixed(2)}`
                  : `开启可最多抵扣 $${billing.maxDiscountUsd.toFixed(2)}`}
            </p>
            <p className={s.pointsNote}>
              {isEn
                ? `Now redeemable: $${redeemableUsdNow.toFixed(0)} / $${maxDiscountUsdInt.toFixed(0)}`
                : `当前可抵：${redeemableUsdNow.toFixed(0)}U / ${maxDiscountUsdInt.toFixed(0)}U`}
            </p>

            <div className={s.pointsBalance}>
              <Sparkles size={11} />
              <span>
                {isEn ? "Balance:" : "当前积分："}{" "}
                <span
                  className={`${s.balanceNum} ${usePoints ? s.balanceNumActive : ""}`}
                >
                  {points}
                </span>
              </span>
            </div>
          </div>
        ) : (
          /* Not eligible */
          <div className={s.pointsUnavailableCard}>
            <div className={s.unavailChip}>
              <div className={s.unavailChipIcon}>
                <Coins size={12} />
              </div>
              <span className={s.unavailChipLabel}>
                {!billing.pointsEnabled
                  ? isEn
                    ? "Points Disabled"
                    : "积分未开启"
                  : isEn
                    ? "Insufficient Points"
                    : "积分不足"}
              </span>
            </div>

            <h4 className={s.unavailTitle}>
              {isEn ? "Earn Points & Save" : "赚取积分，抵扣订阅"}
            </h4>
            <p className={s.unavailDesc}>
              {!billing.pointsEnabled
                ? isEn
                  ? "Points redemption is unavailable for this plan."
                  : "当前套餐暂不支持积分抵扣。"
                : isEn
                  ? `Starts at ${billing.pointsPerUsd} pts, ${billing.pointsPerUsd} pts per $1, up to $${maxDiscountUsdInt}. You have: ${points}`
                  : `满 ${billing.pointsPerUsd} 分起兑，每 ${billing.pointsPerUsd} 分抵 1U，最多抵 ${maxDiscountUsdInt}U。当前 ${points} 分`}
            </p>

            {billing.pointsEnabled && (
              <div className={s.progressWrap}>
                <div className={s.progressHeader}>
                  <span>
                    {points} / {maxPointsForFullDiscount}
                  </span>
                  <span>
                    {isEn
                      ? `$${redeemableUsdNow.toFixed(0)} / $${maxDiscountUsdInt.toFixed(0)}`
                      : `${redeemableUsdNow.toFixed(0)}U / ${maxDiscountUsdInt.toFixed(0)}U`}
                  </span>
                </div>
                <div className={s.progressTrack}>
                  <div
                    className={s.progressFill}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            <div style={{ marginTop: "auto", paddingTop: 16 }}>
              {telegramGroupUrl ? (
                <Link
                  href={telegramGroupUrl}
                  target="_blank"
                  className={s.unavailCta}
                >
                  <MessageSquare size={12} />
                  {isEn ? "Join Telegram to earn" : "加入电报群赚取积分"}
                  <ArrowRight size={11} />
                </Link>
              ) : (
                <span className={s.unavailCta} style={{ cursor: "default" }}>
                  <MessageSquare size={12} />
                  {isEn
                    ? "Join community to earn points"
                    : "加入社群即可赚取积分"}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Payment summary ── */}
      <div className={s.summaryBox}>
        <div className={s.summaryRow}>
          <div>
            <p className={s.summaryLabel}>
              {isEn ? "Total Due Today" : "今日应付"}
            </p>
            {paymentTokenLabel && (
              <p className={s.summaryOriginal}>
                {isEn ? "Token" : "支付币种"}: {paymentTokenLabel}
              </p>
            )}
            {billing.discountAmount > 0 && usePoints && (
              <p className={s.summaryOriginal}>
                ${planPriceUsd.toFixed(2)} USD
              </p>
            )}
          </div>
          <div className={s.summaryAmount}>
            <span className={s.summaryPrice}>
              ${billing.finalPrice.toFixed(2)}
            </span>
            <span className={s.summaryUnit}>USD</span>
          </div>
        </div>

        <div className={s.summaryDivider} />

        <div className={s.ctaWrap}>
          <button onClick={onPay} disabled={payBusy} className={s.ctaBtn}>
            {payBusy ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                <Wallet size={17} />
                {finalPayLabel}
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className={s.footer}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Lock size={11} />
          {isEn ? "Secure Payment" : "安全付款"}
        </span>
        <span style={{ color: "#0f172a" }}>·</span>
        <Link href={faqHref} className={s.footerLink}>
          <BellRing size={11} />
          {isEn ? "Subscription FAQ" : "订阅说明"}
        </Link>
      </div>

      {/* ── Error / Info ── */}
      {errorText && (
        <div className={s.alertError}>
          <div className={`${s.alertIconBox} ${s.alertIconError}`}>
            <X size={10} />
          </div>
          {errorText}
        </div>
      )}
      {infoText && (
        <div className={s.alertInfo}>
          <div className={`${s.alertIconBox} ${s.alertIconInfo}`}>
            <CheckCircle2 size={10} />
          </div>
          <div>
            <div>{infoText}</div>
            {txHref && (
              <Link href={txHref} target="_blank" className={s.txLink}>
                查看链上交易
                <ExternalLink size={11} />
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
