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
    <div className="relative w-full max-w-2xl bg-gradient-to-b from-[#1e293b] to-[#0f172a] border border-white/10 rounded-[2.5rem] p-8 md:p-12 shadow-[0_0_100px_-20px_rgba(59,130,246,0.3)] overflow-hidden">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-8 right-8 p-2 text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-all active:scale-90"
          title={isEn ? "Close" : "关闭"}
        >
          <X size={20} />
        </button>
      )}

      <div className="flex flex-col items-center mb-8">
        <div className="w-20 h-20 bg-gradient-to-tr from-yellow-500 via-amber-400 to-orange-500 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-yellow-500/20 rotate-12 mb-6">
          <Crown className="text-white w-10 h-10 drop-shadow-lg" />
        </div>
        <h2 className="text-3xl font-black text-white tracking-tight text-center">
          {title}
        </h2>
        <p className="text-slate-400 text-sm mt-2 text-center">{subtitle}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10 text-left">
        <div className="p-6 bg-blue-600/10 border-2 border-blue-500/40 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 blur-2xl rounded-full translate-x-1/2 -translate-y-1/2" />
          <div className="relative z-10">
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest block mb-1">
              STANDARD PRO
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white">
                ${planPriceUsd.toFixed(2)}
              </span>
              <span className="text-slate-500 text-sm font-medium">
                / {isEn ? "mo" : "月"}
              </span>
            </div>
            <ul className="mt-4 space-y-2">
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
                  className="flex items-center gap-2 text-[11px] text-slate-400"
                >
                  <CheckCircle2 size={12} className="text-blue-500" /> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {billing.pointsEnabled && billing.isEligible ? (
          <div
            className={`p-6 rounded-3xl border transition-all duration-300 flex flex-col justify-between ${usePoints ? "bg-indigo-500/10 border-indigo-500/50 shadow-inner" : "bg-white/5 border-white/10"}`}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-lg ${usePoints ? "bg-indigo-500 text-white" : "bg-slate-700 text-slate-500"}`}
                  >
                    <Coins size={14} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                    {isEn ? "Points Credit" : "积分抵扣"}
                  </span>
                </div>
                <button
                  onClick={onToggleUsePoints}
                  className={`w-10 h-5 rounded-full relative transition-all duration-300 ${usePoints ? "bg-indigo-500" : "bg-slate-700"}`}
                >
                  <div
                    className={`absolute top-1 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-300 ${usePoints ? "right-1" : "left-1"}`}
                  />
                </button>
              </div>
              <div className="flex items-baseline gap-1">
                <span
                  className={`text-3xl font-black ${usePoints ? "text-green-400" : "text-slate-600"}`}
                >
                  -${billing.discountAmount.toFixed(2)}
                </span>
                <span className="text-slate-500 text-[10px] font-bold">DISCOUNT</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 leading-tight">
              {usePoints
                ? isEn
                  ? `Using ${billing.pointsUsed} points`
                  : `已自动消耗账户内 ${billing.pointsUsed} 积分`
                : isEn
                  ? `Up to $${billing.maxDiscountUsd.toFixed(2)} off`
                  : `开启后最多可抵扣 $${billing.maxDiscountUsd.toFixed(2)}`}
            </p>
          </div>
        ) : (
          <div className="p-6 rounded-3xl border border-dashed border-white/10 bg-white/5 flex flex-col justify-between group hover:border-blue-500/30 transition-all">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-slate-800 rounded-lg text-slate-500 group-hover:text-blue-400 transition-colors">
                  <MessageSquare size={14} />
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {!billing.pointsEnabled
                    ? isEn
                      ? "Points Disabled"
                      : "积分抵扣未开启"
                    : isEn
                      ? "Not Enough Points"
                      : "积分不足"}
                </span>
              </div>
              <h4 className="text-sm font-bold text-white mb-2">
                {isEn ? "Earn Credits in Community" : "活跃赚取抵扣"}
              </h4>
              <p className="text-[11px] text-slate-400 leading-normal">
                {!billing.pointsEnabled
                  ? isEn
                    ? "Points redemption is currently unavailable for this plan."
                    : "当前套餐未开启积分抵扣。"
                  : isEn
                    ? `Need at least ${billing.pointsPerUsd} points. Current: ${points}`
                    : `需要至少 ${billing.pointsPerUsd} 积分，当前 ${points}`}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-center gap-1 text-[10px] text-blue-500/80 font-bold uppercase">
              {telegramGroupUrl ? (
                <Link href={telegramGroupUrl} target="_blank" className="inline-flex items-center gap-1">
                  <span>{isEn ? "Open Telegram" : "前往电报群"}</span>
                  <TrendingUp size={12} className="animate-bounce" />
                </Link>
              ) : (
                <>
                  <span>{isEn ? "Open Telegram" : "前往电报群"}</span>
                  <TrendingUp size={12} className="animate-bounce" />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <span className="text-slate-400 text-sm font-medium">
            {isEn ? "Total Due:" : "应付总计:"}
          </span>
          <div className="text-right">
            <span className="text-4xl font-black text-white font-mono tracking-tighter">
              ${billing.finalPrice.toFixed(2)}
            </span>
            <span className="text-slate-500 text-sm ml-2 font-mono uppercase tracking-widest">
              USD
            </span>
          </div>
        </div>

        <button
          onClick={onPay}
          disabled={payBusy}
          className="w-full py-5 bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-lg rounded-[1.5rem] shadow-2xl shadow-blue-600/30 transition-all active:scale-[0.98] flex items-center justify-center gap-3 group disabled:opacity-70"
        >
          {payBusy ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <>
              <Wallet size={20} />
              {finalPayLabel}
              <ArrowRight
                size={20}
                className="group-hover:translate-x-1 transition-transform"
              />
            </>
          )}
        </button>

        <div className="flex justify-center items-center gap-6 pt-4 text-[10px] text-slate-600 uppercase tracking-widest font-bold">
          <span className="flex items-center gap-1.5">
            <Lock size={12} /> Secure Payment
          </span>
          <Link
            href={faqHref}
            className="flex items-center gap-1.5 hover:text-slate-400 transition-colors"
          >
            <BellRing size={12} /> Subscription FAQ
          </Link>
        </div>

        {errorText ? (
          <div className="mt-2 text-xs text-rose-400 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
            {errorText}
          </div>
        ) : null}
        {infoText ? (
          <div className="mt-2 text-xs text-emerald-400 bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
            {infoText}
          </div>
        ) : null}
      </div>
    </div>
  );
}