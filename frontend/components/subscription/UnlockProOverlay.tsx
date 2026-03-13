"use client";

import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Coins,
  Crown,
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
};

const features = {
  "zh-CN": [
    { icon: TrendingUp, label: "15天高精度趋势预报" },
    { icon: Radar, label: "实时多源雷达图" },
    { icon: Send, label: "全平台智能气象推送" },
  ],
  "en-US": [
    { icon: TrendingUp, label: "15-day precision forecast" },
    { icon: Radar, label: "Real-time radar panel" },
    { icon: Send, label: "Cross-platform alert push" },
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
}: UnlockProOverlayProps) {
  const isEn = locale === "en-US";

  const title = isEn ? "Unlock PolyWeather Pro" : "解锁 PolyWeather Pro";
  const subtitle = isEn
    ? "High-precision weather intelligence, delivered everywhere."
    : "全球最精准的高精度气象推送，全平台覆盖";

  const finalPayLabel =
    payLabel || (isEn ? "Subscribe & Activate" : "立即订阅并激活服务");

  const featureList = features[locale] ?? features["zh-CN"];

  const canUsePoints = billing.pointsEnabled && billing.isEligible;

  return (
    <div className="relative w-full max-w-[820px] overflow-hidden rounded-[32px] border border-white/[0.08] bg-[#0c1220] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_32px_80px_-16px_rgba(0,0,0,0.7),0_0_120px_-40px_rgba(99,130,246,0.25)]">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-72 w-72 rounded-full bg-blue-600/20 blur-[80px]" />
        <div className="absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-indigo-600/15 blur-[80px]" />
        <div className="absolute left-1/2 top-0 h-px w-3/4 -translate-x-1/2 bg-gradient-to-r from-transparent via-blue-400/30 to-transparent" />
      </div>

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-500 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/10 hover:text-white active:scale-90"
          title={isEn ? "Close" : "关闭"}
        >
          <X size={16} />
        </button>
      )}

      <div className="relative z-10 p-6 md:p-8 lg:p-10">
        {/* Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          {/* Badge */}
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3.5 py-1.5 backdrop-blur-sm">
            <Crown size={13} className="text-amber-400" />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Pro
            </span>
          </div>

          <h2 className="bg-gradient-to-b from-white via-white to-slate-300 bg-clip-text text-4xl font-black leading-[1.05] tracking-tight text-transparent md:text-5xl lg:text-[3.25rem]">
            {title}
          </h2>
          <p className="mt-3 max-w-[440px] text-sm leading-relaxed text-slate-400 md:text-[15px]">
            {subtitle}
          </p>
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr]">
          {/* Left: Plan card */}
          <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-600/10 via-blue-500/5 to-transparent p-5 md:p-6">
            {/* Inner glow */}
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-blue-500/20 blur-2xl" />

            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300">
                  <Zap size={10} />
                  Standard Pro
                </span>
                <span className="text-[11px] text-slate-500">
                  / {isEn ? "mo" : "月"}
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[52px] font-black leading-none tracking-tight text-white">
                  ${planPriceUsd.toFixed(2)}
                </span>
              </div>

              <div className="mt-5 space-y-2.5">
                {featureList.map(({ icon: Icon, label }, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-blue-500/20">
                      <CheckCircle2 size={12} className="text-blue-400" />
                    </div>
                    <span className="text-[13px] text-slate-300">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Points card */}
          {canUsePoints ? (
            <div
              className={`relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 md:p-6 ${
                usePoints
                  ? "border-emerald-500/30 bg-gradient-to-br from-emerald-600/10 via-emerald-500/5 to-transparent"
                  : "border-white/[0.08] bg-white/[0.03]"
              }`}
            >
              <div
                className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-2xl transition-all duration-300 ${
                  usePoints ? "bg-emerald-500/15" : "bg-transparent"
                }`}
              />

              <div className="relative">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-200 ${
                        usePoints
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Coins size={14} />
                    </div>
                    <span
                      className={`text-[11px] font-bold uppercase tracking-[0.12em] transition-colors duration-200 ${
                        usePoints ? "text-emerald-300" : "text-slate-500"
                      }`}
                    >
                      {isEn ? "Points Credit" : "积分抵扣"}
                    </span>
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={onToggleUsePoints}
                    className={`relative h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-all duration-300 ${
                      usePoints ? "bg-emerald-500" : "bg-slate-700"
                    }`}
                  >
                    <div
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all duration-200 ${
                        usePoints ? "right-1" : "left-1"
                      }`}
                    />
                  </button>
                </div>

                {/* Discount display */}
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span
                    className={`text-[48px] font-black leading-none tracking-tight transition-colors duration-300 ${
                      usePoints ? "text-emerald-400" : "text-slate-600"
                    }`}
                  >
                    -${billing.discountAmount.toFixed(2)}
                  </span>
                  <span className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600">
                    off
                  </span>
                </div>

                <p className="mt-3 text-[12px] leading-5 text-slate-400">
                  {usePoints
                    ? isEn
                      ? `Using ${billing.pointsUsed} pts · saves $${billing.discountAmount.toFixed(2)}`
                      : `已消耗 ${billing.pointsUsed} 积分 · 省 $${billing.discountAmount.toFixed(2)}`
                    : isEn
                      ? `Toggle to save up to $${billing.maxDiscountUsd.toFixed(2)}`
                      : `开启可最多抵扣 $${billing.maxDiscountUsd.toFixed(2)}`}
                </p>

                {/* Points balance */}
                <div className="mt-4 flex items-center gap-1.5">
                  <Sparkles size={11} className="text-slate-600" />
                  <span className="text-[11px] text-slate-500">
                    {isEn ? "Your balance:" : "当前积分："}{" "}
                    <span
                      className={`font-bold ${
                        usePoints ? "text-emerald-400" : "text-slate-400"
                      }`}
                    >
                      {points}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Not eligible / points disabled */
            <div className="group relative overflow-hidden rounded-2xl border border-dashed border-white/10 bg-white/[0.025] p-5 transition-all duration-300 hover:border-white/20 md:p-6">
              <div className="relative flex h-full flex-col">
                {/* Top */}
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-600 transition-colors duration-200 group-hover:bg-slate-700 group-hover:text-slate-400">
                      <Coins size={14} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                      {!billing.pointsEnabled
                        ? isEn
                          ? "Points Disabled"
                          : "积分未开启"
                        : isEn
                          ? "Insufficient Points"
                          : "积分不足"}
                    </span>
                  </div>

                  <h4 className="text-base font-bold text-slate-200">
                    {isEn ? "Earn Points & Save" : "赚取积分，抵扣订阅"}
                  </h4>
                  <p className="mt-1.5 text-[12px] leading-5 text-slate-500">
                    {!billing.pointsEnabled
                      ? isEn
                        ? "Points redemption is unavailable for this plan."
                        : "当前套餐暂不支持积分抵扣。"
                      : isEn
                        ? `Need ${billing.pointsPerUsd} pts minimum. You have: ${points}`
                        : `至少需要 ${billing.pointsPerUsd} 积分，当前仅有 ${points}`}
                  </p>
                </div>

                {/* Progress bar */}
                {billing.pointsEnabled && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-600">
                      <span>
                        {points} / {billing.pointsPerUsd}
                      </span>
                      <span>
                        {Math.min(
                          100,
                          Math.round((points / billing.pointsPerUsd) * 100),
                        )}
                        %
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (points / billing.pointsPerUsd) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Bottom CTA */}
                <div className="mt-auto pt-4">
                  {telegramGroupUrl ? (
                    <Link
                      href={telegramGroupUrl}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 transition-colors hover:text-blue-300"
                    >
                      <MessageSquare size={12} />
                      {isEn ? "Join Telegram to earn" : "加入电报群赚取积分"}
                      <ArrowRight size={11} />
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                      <MessageSquare size={12} />
                      {isEn
                        ? "Join community to earn points"
                        : "加入社群即可赚取积分"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Payment summary */}
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          {/* Summary row */}
          <div className="flex items-center justify-between px-5 py-4">
            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                {isEn ? "Total Due Today" : "今日应付"}
              </p>
              {billing.discountAmount > 0 && usePoints && (
                <p className="text-[11px] text-slate-600 line-through">
                  ${planPriceUsd.toFixed(2)} USD
                </p>
              )}
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[36px] font-black leading-none tracking-tight text-white md:text-[42px]">
                ${billing.finalPrice.toFixed(2)}
              </span>
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
                USD
              </span>
            </div>
          </div>

          {/* CTA Button */}
          <div className="border-t border-white/[0.06] p-3">
            <button
              onClick={onPay}
              disabled={payBusy}
              className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3.5 text-[15px] font-bold text-white shadow-[0_0_0_1px_rgba(99,102,241,0.5),0_8px_32px_-8px_rgba(99,102,241,0.6)] transition-all duration-200 hover:from-blue-500 hover:to-indigo-500 hover:shadow-[0_0_0_1px_rgba(99,102,241,0.7),0_12px_40px_-8px_rgba(99,102,241,0.7)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {/* Shimmer */}
              <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

              {payBusy ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  <Wallet size={17} />
                  <span>{finalPayLabel}</span>
                  <ArrowRight
                    size={17}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer links */}
        <div className="mt-4 flex items-center justify-center gap-6 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700">
          <span className="flex items-center gap-1.5">
            <Lock size={11} />
            {isEn ? "Secure Payment" : "安全付款"}
          </span>
          <span className="text-slate-800">·</span>
          <Link
            href={faqHref}
            className="flex items-center gap-1.5 transition-colors hover:text-slate-500"
          >
            <BellRing size={11} />
            {isEn ? "Subscription FAQ" : "订阅说明"}
          </Link>
        </div>

        {/* Error / Info messages */}
        {errorText && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/8 p-3">
            <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-rose-500/20">
              <X size={10} className="text-rose-400" />
            </div>
            <p className="text-[12px] leading-5 text-rose-400">{errorText}</p>
          </div>
        )}
        {infoText && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3">
            <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
              <CheckCircle2 size={10} className="text-emerald-400" />
            </div>
            <p className="text-[12px] leading-5 text-emerald-400">{infoText}</p>
          </div>
        )}
      </div>
    </div>
  );
}
