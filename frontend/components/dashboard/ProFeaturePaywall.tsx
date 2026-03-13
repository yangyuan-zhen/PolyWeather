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
import { useMemo, useState } from "react";

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
  const PRO_PRICE = 5;
  const POINTS_VAL = 500;
  const MAX_DISCOUNT = 3;

  const pointsAvailable = proAccess.points || 0;

  const billing = useMemo(() => {
    const maxRedeemable = MAX_DISCOUNT * POINTS_VAL;
    const actualRedeem = Math.min(pointsAvailable, maxRedeemable);
    const discount = Math.floor(actualRedeem / POINTS_VAL);
    return {
      pointsUsed: discount * POINTS_VAL,
      discountAmount: discount,
      payAmount: PRO_PRICE - (usePoints ? discount : 0),
    };
  }, [usePoints, pointsAvailable]);

  return (
    <div className="flex w-full flex-col items-center justify-center py-6 md:py-10 z-30 p-4">
      <div className="w-full max-w-2xl bg-[#161b2a]/90 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-8 md:p-12 shadow-[0_0_80px_-10px_rgba(79,70,229,0.3)] text-center relative">
        {/* 关闭按钮 */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-2 bg-white/5 hover:bg-white/10 rounded-full text-slate-500 hover:text-white transition-all z-10"
            title={isEn ? "Close" : "稍后再说"}
          >
            <X size={20} />
          </button>
        )}

        {/* Crown Badge */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-20 h-20 bg-gradient-to-tr from-yellow-500 to-amber-400 rounded-3xl flex items-center justify-center shadow-2xl rotate-12">
          <Crown className="text-white w-10 h-10" fill="currentColor" />
        </div>

        <h2 className="text-3xl font-bold text-white mb-4 mt-4">
          {isEn ? "Unlock PolyWeather Pro" : "开启 PolyWeather Pro"}
        </h2>
        <p className="text-slate-400 mb-10 max-w-md mx-auto">
          {isEn
            ? "Unlock 15-day precision trends, real-time radar, and ad-free experience across all platforms."
            : "解锁 15 天高精度趋势分析、实时雷达与闪电追踪。尊享全平台无广告体验。"}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left mb-10">
          {/* 订阅方案卡片 */}
          <div className="p-6 bg-blue-600/10 border-2 border-blue-500/50 rounded-3xl relative">
            <div className="absolute -top-3 right-6 bg-blue-500 text-[10px] px-2 py-1 rounded font-bold text-white uppercase tracking-tighter">
              {isEn ? "Monthly" : "月付套餐"}
            </div>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1">
              PRO PLAN
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black text-white">$5.00</span>
              <span className="text-slate-500 text-sm">
                / {isEn ? "mo" : "月"}
              </span>
            </div>
          </div>

          {/* 积分抵扣卡片 */}
          <div
            className={`p-6 rounded-3xl border transition-all ${usePoints && pointsAvailable >= 500 ? "bg-indigo-600/20 border-indigo-500/50" : "bg-white/5 border-white/10"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className={`text-[10px] font-bold uppercase tracking-widest ${usePoints && pointsAvailable >= 500 ? "text-indigo-400" : "text-slate-500"}`}
              >
                {isEn ? "Points Credit" : "积分抵扣"}
              </span>
              <button
                onClick={() => setUsePoints(!usePoints)}
                disabled={pointsAvailable < 500}
                className={`w-10 h-5 rounded-full relative transition-all ${usePoints && pointsAvailable >= 500 ? "bg-indigo-500" : "bg-slate-700"} ${pointsAvailable < 500 ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div
                  className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${usePoints && pointsAvailable >= 500 ? "right-1" : "left-1"}`}
                />
              </button>
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className={`text-3xl font-black ${usePoints && pointsAvailable >= 500 ? "text-emerald-400" : "text-slate-500"}`}
              >
                -${billing.discountAmount.toFixed(2)}
              </span>
              <span className="text-slate-500 text-[10px] font-bold uppercase">
                OFF
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1 italic">
              {pointsAvailable < 500
                ? isEn
                  ? `Need 500+ points (Current: ${pointsAvailable})`
                  : `积分不足 (当前 ${pointsAvailable})`
                : usePoints
                  ? isEn
                    ? `Consumed ${billing.pointsUsed} points`
                    : `已自动消耗 ${billing.pointsUsed} 积分`
                  : isEn
                    ? "Up to $3.00 off"
                    : "开启后最多抵扣 $3.00"}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between px-2 text-sm">
            <span className="text-slate-400">
              {isEn ? "Total Due:" : "应付总计:"}
            </span>
            <span className="text-3xl font-black text-white">
              ${billing.payAmount.toFixed(2)}
            </span>
          </div>

          <Link
            href="/account"
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl shadow-xl shadow-blue-600/30 transition-all flex items-center justify-center gap-2 group active:scale-95 text-lg"
          >
            {isEn ? "Connect Wallet & Pay" : "连接钱包并支付"}
            <ArrowRight
              size={20}
              className="group-hover:translate-x-1 transition-transform"
            />
          </Link>

          <div className="flex justify-center items-center gap-6 text-[10px] font-medium text-slate-500 uppercase tracking-widest">
            <span className="flex items-center gap-1.5">
              <Lock size={12} className="opacity-50" />{" "}
              {isEn ? "Secured Payment" : "安全加密支付"}
            </span>
            <Link
              href="/account"
              className="hover:text-white cursor-pointer transition-colors"
            >
              {isEn ? "FAQ" : "常见问题 (FAQ)"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
