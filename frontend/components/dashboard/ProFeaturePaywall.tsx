"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Crown,
  Lock,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useState } from "react";

type ProFeaturePaywallProps = {
  feature: "today" | "history" | "future";
  onClose?: () => void;
};

export function ProFeaturePaywall({
  feature,
  onClose,
}: ProFeaturePaywallProps) {
  const { locale } = useI18n();
  const { proAccess } = useDashboardStore();
  const [usePoints, setUsePoints] = useState(true);

  const isEn = locale === "en-US";

  // Redemption logic: 500 points = $1 discount
  // Max discount $3 (requires 1500 points)
  const maxRedeemablePoints = 1500;
  const pointsAvailable = proAccess.points || 0;
  const effectivePoints = Math.min(pointsAvailable, maxRedeemablePoints);
  const discountAmount = usePoints ? Math.floor(effectivePoints / 500) : 0;
  const originalPrice = 5.0;
  const finalPrice = originalPrice - discountAmount;
  const pointsToConsume = discountAmount * 500;

  return (
    <div className="flex w-full flex-col items-center justify-center py-6 md:py-10">
      <div className="relative w-full max-w-xl rounded-[2.5rem] border border-white/10 bg-slate-900/80 p-8 shadow-3xl backdrop-blur-3xl md:p-12">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white z-10"
          >
            <X size={20} />
          </button>
        )}

        {/* Crown Badge */}
        <div className="absolute left-1/2 top-0 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 rotate-[-6deg] items-center justify-center rounded-[1.5rem] border-4 border-slate-950 bg-gradient-to-tr from-amber-400 via-orange-500 to-yellow-500 text-white shadow-2xl shadow-orange-500/30">
          <Crown size={32} fill="white" />
        </div>

        <div className="mt-4 text-center">
          <h3 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">
            {isEn ? "Unlock PolyWeather Pro" : "开启 PolyWeather Pro"}
          </h3>
          <p className="mx-auto mt-4 max-w-sm text-base leading-relaxed text-slate-400">
            {isEn
              ? "Unlock 15-day precision trends, real-time radar, and ad-free experience across all platforms."
              : "解锁 15 天高精度趋势分析、实时雷达与闪电追踪。尊享全平台无广告体验。"}
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Plan Card */}
          <div className="relative overflow-hidden rounded-3xl border border-blue-500/30 bg-blue-500/5 p-6 transition hover:bg-blue-500/10">
            <div className="absolute -right-2 -top-1 rotate-12 rounded-lg bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-tighter shadow-lg">
              {isEn ? "Monthly" : "月付套餐"}
            </div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              PRO PLAN
            </div>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-black text-white">$5.00</span>
              <span className="ml-1 text-sm font-medium text-slate-500">
                / {isEn ? "mo" : "月"}
              </span>
            </div>
          </div>

          {/* Points Card */}
          <div
            className={`relative rounded-3xl border p-6 transition ${
              usePoints && pointsAvailable >= 500
                ? "border-indigo-500/30 bg-indigo-500/5"
                : "border-white/5 bg-white/5 opacity-60"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] font-bold uppercase tracking-widest ${
                  usePoints && pointsAvailable >= 500
                    ? "text-indigo-400"
                    : "text-slate-500"
                }`}
              >
                {isEn ? "Points Credit" : "积分抵扣"}
              </span>
              <button
                onClick={() => setUsePoints(!usePoints)}
                disabled={pointsAvailable < 500}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  usePoints && pointsAvailable >= 500
                    ? "bg-indigo-600"
                    : "bg-slate-700"
                } ${pointsAvailable < 500 ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    usePoints && pointsAvailable >= 500
                      ? "translate-x-5"
                      : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <div className="mt-2 flex items-baseline">
              <span
                className={`text-3xl font-black ${usePoints && pointsAvailable >= 500 ? "text-emerald-400" : "text-slate-500"}`}
              >
                -${discountAmount.toFixed(2)}
              </span>
              <span className="ml-1 text-[10px] font-bold text-slate-500 uppercase">
                OFF
              </span>
            </div>
            <div className="mt-1 text-[10px] font-medium text-slate-500">
              {pointsAvailable < 500
                ? isEn
                  ? "Need 500+ points"
                  : `积分不足 (当前 ${pointsAvailable})`
                : isEn
                  ? `Auto-consume ${pointsToConsume} points`
                  : `已自动消耗 ${pointsToConsume} 积分`}
            </div>
          </div>
        </div>

        {/* Total & Action */}
        <div className="mt-10 space-y-6">
          <div className="flex items-center justify-between px-2">
            <span className="text-sm font-medium text-slate-400">
              {isEn ? "Total Due:" : "应付总计:"}
            </span>
            <span className="text-3xl font-black text-white">
              ${finalPrice.toFixed(2)}
            </span>
          </div>

          <Link
            href="/account"
            className="group flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 text-lg font-bold text-white shadow-2xl shadow-blue-600/30 transition hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98]"
          >
            {isEn ? "Connect Wallet & Pay" : "连接钱包并支付"}
            <ArrowRight
              size={20}
              className="ml-2 transition-transform group-hover:translate-x-1"
            />
          </Link>

          <div className="flex items-center justify-center gap-6">
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
              <Lock size={12} className="opacity-50" />
              {isEn ? "Secured Payment" : "安全加密支付"}
            </span>
            <Link
              href="/account"
              className="text-[10px] font-medium text-slate-500 transition hover:text-slate-300"
            >
              {isEn ? "FAQ" : "常见问题 (FAQ)"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
