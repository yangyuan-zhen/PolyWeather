"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Crown,
  Lock,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

type ProFeaturePaywallProps = {
  feature: "today" | "history" | "future";
};

function getFeatureLabel(
  locale: "zh-CN" | "en-US",
  feature: "today" | "history" | "future",
) {
  if (locale === "en-US") {
    if (feature === "today") return "Intraday Analysis";
    if (feature === "history") return "History Reconciliation";
    return "Future-date Analysis";
  }
  if (feature === "today") return "今日日内分析";
  if (feature === "history") return "历史对账";
  return "未来日期分析";
}

export function ProFeaturePaywall({ feature }: ProFeaturePaywallProps) {
  const { locale } = useI18n();
  const featureLabel = getFeatureLabel(locale, feature);
  const isEn = locale === "en-US";

  return (
    <div className="mx-auto w-full max-w-4xl rounded-[2rem] border border-white/10 bg-gradient-to-b from-slate-800/95 to-slate-950/95 p-8 md:p-10">
      <div className="mx-auto mb-5 flex h-16 w-16 -translate-y-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-400 text-white shadow-xl shadow-amber-500/20">
        <Crown size={28} />
      </div>

      <div className="-mt-6 text-center">
        <h3 className="text-3xl font-bold text-white">
          {isEn ? "Unlock PolyWeather Pro" : "开启 PolyWeather Pro"}
        </h3>
        <p className="mx-auto mt-4 max-w-2xl text-base text-slate-300">
          {isEn
            ? `This module (${featureLabel}) is available for subscribers only. Upgrade to unlock advanced weather intelligence.`
            : `当前模块（${featureLabel}）仅对订阅用户开放。升级后可解锁更完整的气象分析能力。`}
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        {[
          {
            icon: Zap,
            text: isEn ? "Real-time radar and lightning tracking" : "实时雷达与闪电追踪",
          },
          {
            icon: ShieldCheck,
            text: isEn ? "15-day high-precision trend analysis" : "15 天高精度趋势分析",
          },
          {
            icon: BarChart3,
            text: isEn ? "Pro-grade station raw data" : "专业级气象站原始数据",
          },
          {
            icon: Sparkles,
            text: isEn ? "Ad-free experience across all surfaces" : "全平台无广告体验",
          },
        ].map((item) => (
          <div
            key={item.text}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <item.icon size={17} className="text-cyan-300" />
            <span className="text-sm text-slate-200">{item.text}</span>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Link
          href="/account"
          className="group flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4 text-lg font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:from-blue-500 hover:to-indigo-500"
        >
          {isEn ? "Upgrade now - $5 / month" : "立即升级 - $5 / 月"}
          <ArrowRight
            size={19}
            className="ml-2 transition-transform group-hover:translate-x-1"
          />
        </Link>
      </div>

      <div className="mt-6 border-t border-white/10 pt-4 text-center text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <Lock size={12} />
          {isEn ? "Payments are secured with AES-256 encryption" : "所有交易均经过 AES-256 加密保护"}
        </span>
      </div>
    </div>
  );
}
