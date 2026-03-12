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
    <div className="flex w-full flex-col items-center justify-center py-10 md:py-16">
      <div className="relative w-full max-w-4xl rounded-[2.5rem] border border-white/10 bg-slate-900/60 backdrop-blur-xl p-8 shadow-2xl md:p-12">
        <div className="absolute left-1/2 top-0 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[1.5rem] border-4 border-slate-950 bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-400 text-white shadow-2xl shadow-orange-500/40">
          <Crown size={32} fill="currentColor" />
        </div>

        <div className="mt-4 text-center">
          <h3 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">
            {isEn ? "Unlock PolyWeather Pro" : "开启 PolyWeather Pro"}
          </h3>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-300">
            {isEn
              ? `This module (${featureLabel}) is available for subscribers only. Upgrade to unlock advanced weather intelligence.`
              : `当前模块（${featureLabel}）仅对订阅用户开放。升级后可解锁更完整的气象分析能力。`}
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            {
              icon: Zap,
              text: isEn
                ? "Real-time radar and lightning tracking"
                : "实时雷达与闪电追踪",
            },
            {
              icon: ShieldCheck,
              text: isEn
                ? "15-day high-precision trend analysis"
                : "15 天高精度趋势分析",
            },
            {
              icon: BarChart3,
              text: isEn
                ? "Pro-grade station raw data"
                : "专业级气象站原始数据",
            },
            {
              icon: Sparkles,
              text: isEn
                ? "Ad-free experience across all surfaces"
                : "全平台无广告体验",
            },
          ].map((item) => (
            <div
              key={item.text}
              className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/5 px-5 py-4 transition hover:bg-white/10"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
                <item.icon size={20} />
              </div>
              <span className="text-base font-medium text-slate-200">
                {item.text}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <Link
            href="/account"
            className="group flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 text-xl font-bold text-white shadow-xl shadow-blue-600/20 transition hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98]"
          >
            {isEn ? "Upgrade now - $5 / month" : "立即升级 - $5 / 月"}
            <ArrowRight
              size={22}
              className="ml-2 transition-transform group-hover:translate-x-1"
            />
          </Link>
        </div>

        <div className="mt-8 border-t border-white/10 pt-6 text-center text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            <Lock size={14} className="text-slate-500" />
            {isEn
              ? "Payments are secured with AES-256 encryption"
              : "所有交易均经过 AES-256 加密保护"}
          </span>
        </div>
      </div>
    </div>
  );
}
