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
  TrendingUp,
  Wallet,
  X,
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
    ? "Get high-precision weather intelligence and full-platform alerts."
    : "获取全球最精准的高精度气象推送";

  const finalPayLabel =
    payLabel || (isEn ? "Subscribe & Activate" : "立即订阅并激活服务");

  return (
    <div className="relative w-full max-w-[860px] max-h-[calc(100dvh-2.5rem)] overflow-x-hidden overflow-y-auto rounded-[28px] border border-white/10 bg-gradient-to-b from-[#1a2740] via-[#14233b] to-[#0f172a] p-5 md:p-8 lg:p-10 shadow-[0_0_90px_-24px_rgba(59,130,246,0.35)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.2),transparent_40%),radial-gradient(circle_at_80%_100%,rgba(99,102,241,0.18),transparent_45%)]" />
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-5 top-5 z-20 rounded-full bg-white/8 p-2 text-slate-500 transition-all hover:bg-white/15 hover:text-white active:scale-90"
          title={isEn ? "Close" : "关闭"}
        >
          <X size={18} />
        </button>
      )}

      <div className="relative z-10">
        <div className="mx-auto mb-5 flex max-w-[580px] flex-col items-center text-center md:mb-7">
          <div className="mb-4 flex h-14 w-14 rotate-12 items-center justify-center rounded-3xl bg-gradient-to-tr from-yellow-500 via-amber-400 to-orange-500 shadow-2xl shadow-yellow-500/25 md:mb-5 md:h-16 md:w-16">
            <Crown className="h-7 w-7 text-white drop-shadow-lg md:h-8 md:w-8" />
          </div>
          <h2 className="text-3xl font-black leading-[1.06] tracking-tight text-white md:text-5xl">
            {title}
          </h2>
          <p className="mt-2 max-w-[520px] text-sm leading-5 text-slate-300 md:text-base md:leading-6">
            {subtitle}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 text-left md:grid-cols-2">
          <div className="relative min-h-[188px] rounded-3xl border border-blue-500/45 bg-blue-600/10 p-5 md:min-h-[208px] md:p-6">
            <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 translate-x-1/3 -translate-y-1/3 rounded-full bg-blue-500/15 blur-2xl" />
            <div className="relative z-10">
              <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-blue-300">
                STANDARD PRO
              </span>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[48px] font-black leading-none text-white md:text-5xl">
                  ${planPriceUsd.toFixed(2)}
                </span>
                <span className="text-sm font-semibold text-slate-400">
                  / {isEn ? "mo" : "月"}
                </span>
              </div>
              <ul className="mt-5 space-y-2">
                {(isEn
                  ? [
                      "15-day high precision trend",
                      "Realtime radar panel",
                      "Cross-platform alert push",
                    ]
                  : ["15天趋势预报", "实时雷达图", "全平台推送"]
                ).map((item, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-[12px] text-slate-300"
                  >
                    <CheckCircle2 size={13} className="text-blue-400" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {billing.pointsEnabled && billing.isEligible ? (
            <div
              className={`min-h-[188px] rounded-3xl border p-5 transition-all md:min-h-[208px] md:p-6 ${usePoints ? "border-indigo-500/55 bg-indigo-500/12 shadow-inner shadow-indigo-500/8" : "border-white/10 bg-white/6"}`}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`rounded-lg p-1.5 ${usePoints ? "bg-indigo-500 text-white" : "bg-slate-700 text-slate-400"}`}
                  >
                    <Coins size={14} />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300">
                    {isEn ? "Points Credit" : "积分抵扣"}
                  </span>
                </div>
                <button
                  onClick={onToggleUsePoints}
                  className={`relative h-6 w-11 rounded-full transition-all ${usePoints ? "bg-indigo-500" : "bg-slate-700"}`}
                >
                  <div
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${usePoints ? "right-1" : "left-1"}`}
                  />
                </button>
              </div>
              <div className="flex items-end gap-1">
                <span
                  className={`text-5xl font-black leading-none ${usePoints ? "text-emerald-400" : "text-slate-500"}`}
                >
                  -${billing.discountAmount.toFixed(2)}
                </span>
                <span className="pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  DISCOUNT
                </span>
              </div>
              <p className="mt-6 text-[12px] leading-6 text-slate-400">
                {usePoints
                  ? isEn
                    ? `Using ${billing.pointsUsed} points from your account`
                    : `已自动消耗账户内 ${billing.pointsUsed} 积分`
                  : isEn
                    ? `Enable to save up to $${billing.maxDiscountUsd.toFixed(2)}`
                    : `开启后最多可抵扣 $${billing.maxDiscountUsd.toFixed(2)}`}
              </p>
            </div>
          ) : (
            <div className="group flex min-h-[188px] flex-col justify-between rounded-3xl border border-dashed border-white/20 bg-white/5 p-5 transition-all hover:border-blue-500/35 md:min-h-[208px] md:p-6">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="rounded-lg bg-slate-800 p-1.5 text-slate-500 transition-colors group-hover:text-blue-400">
                    <MessageSquare size={14} />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    {!billing.pointsEnabled
                      ? isEn
                        ? "Points Disabled"
                        : "积分未开启"
                      : isEn
                        ? "Not Enough Points"
                        : "积分不足"}
                  </span>
                </div>
                <h4 className="mb-2 text-base font-bold text-white">
                  {isEn ? "Earn Credits in Community" : "活跃赚取抵扣"}
                </h4>
                <p className="text-[12px] leading-6 text-slate-300">
                  {!billing.pointsEnabled
                    ? isEn
                      ? "Points redemption is currently unavailable for this plan."
                      : "当前套餐未开启积分抵扣。"
                    : isEn
                      ? `Need at least ${billing.pointsPerUsd} points. Current: ${points}`
                      : `需要至少 ${billing.pointsPerUsd} 积分，当前 ${points}`}
                </p>
              </div>
              <div className="mt-5 flex items-center justify-center text-[11px] font-bold text-blue-400">
                {telegramGroupUrl ? (
                  <Link
                    href={telegramGroupUrl}
                    target="_blank"
                    className="inline-flex items-center gap-1.5"
                  >
                    <span>{isEn ? "Open Telegram" : "前往电报群"}</span>
                    <TrendingUp size={13} />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {isEn ? "Open Telegram" : "前往电报群"}
                    <TrendingUp size={13} />
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-white/10 pt-4 md:mt-7 md:pt-5">
          <div className="flex items-center justify-between gap-4 px-1">
            <span className="text-base font-medium text-slate-300">
              {isEn ? "Total Due" : "应付总计"}
            </span>
            <div className="text-right">
              <span className="font-mono text-4xl font-black leading-none tracking-tight text-white md:text-5xl">
                ${billing.finalPrice.toFixed(2)}
              </span>
              <span className="ml-2 font-mono text-sm uppercase tracking-[0.12em] text-slate-500">
                USD
              </span>
            </div>
          </div>

          <button
            onClick={onPay}
            disabled={payBusy}
            className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 py-3.5 text-lg font-black text-white shadow-2xl shadow-blue-600/30 transition-all hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] disabled:opacity-70 md:mt-5 md:py-4"
          >
            {payBusy ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                <Wallet size={20} />
                {finalPayLabel}
                <ArrowRight
                  size={20}
                  className="transition-transform group-hover:translate-x-1"
                />
              </>
            )}
          </button>

          <div className="mt-4 flex items-center justify-center gap-5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-600 md:mt-5 md:gap-6">
            <span className="flex items-center gap-1.5">
              <Lock size={12} /> Secure Payment
            </span>
            <Link
              href={faqHref}
              className="flex items-center gap-1.5 transition-colors hover:text-slate-400"
            >
              <BellRing size={12} /> Subscription FAQ
            </Link>
          </div>

          {errorText ? (
            <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-xs text-rose-400">
              {errorText}
            </div>
          ) : null}
          {infoText ? (
            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-xs text-emerald-400">
              {infoText}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
