"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Coins,
  CreditCard,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

const FAQ_ITEMS = [
  {
    q_zh: "Pro 包含哪些功能？",
    q_en: "What features does Pro include?",
    a_zh: "开通后可解锁：天气决策台、多城市图表巡检、未来日期分析、全平台智能气象推送。",
    a_en: "Unlocks: weather decision terminal, multi-city chart monitoring, future-date analysis, and cross-platform smart weather push.",
  },
  {
    q_zh: "当前订阅价格是多少？",
    q_en: "What is the current subscription price?",
    a_zh: "Pro 月付 29.9 USDC / 30 天，Pro 季度 79.9 USDC / 90 天。",
    a_en: "Pro monthly is 29.9 USDC / 30 days. Pro quarterly is 79.9 USDC / 90 days.",
  },
  {
    q_zh: "积分如何抵扣？",
    q_en: "How do points work for discounts?",
    a_zh: "满 500 积分起兑，每 500 积分抵 1U。月付最多抵 3U，季度最多抵 8U。",
    a_en: "500 points minimum: every 500 points = 1 USDC off. Monthly orders can use up to 3 USDC off; quarterly orders can use up to 8 USDC off.",
  },
  {
    q_zh: "支持哪些钱包和支付方式？",
    q_en: "Which wallets and payment methods are supported?",
    a_zh: "支持 EVM 浏览器钱包（MetaMask / OKX / Rabby / Bitget 等）及 WalletConnect 扫码钱包（Trust Wallet / Binance Web3 Wallet / TokenPocket 等）。",
    a_en: "EVM browser wallets (MetaMask, OKX, Rabby, Bitget, etc.) and WalletConnect-compatible wallets (Trust Wallet, Binance Web3 Wallet, TokenPocket, etc.).",
  },
];

export function SubscriptionHelpClient() {
  const { locale } = useI18n();
  const isEn = locale === "en-US";

  const copy = useMemo(() => ({
    back: isEn ? "Back to Account" : "返回账户中心",
    title: isEn ? "PolyWeather Pro Subscription Guide" : "PolyWeather Pro 订阅说明",
    description: isEn
      ? "Complete subscription rules and payment guide."
      : "这里是完整的订阅规则和支付说明。你可以先在页面内绑定钱包，再直接开通 Pro。",
    priceLabel: isEn ? "Price" : "订阅价格",
    priceText: isEn ? "29.9 / 30d · 79.9 / 90d" : "29.9 / 30天 · 79.9 / 90天",
    discountLabel: isEn ? "Points Discount" : "积分抵扣",
    discountText: isEn ? "Monthly 3U · Quarterly 8U" : "月付 3U · 季度 8U",
    communityLabel: isEn ? "Telegram Group" : "Telegram 群",
    communityLink: isEn ? "Open Account Center" : "前往账户中心",
    faqTitle: isEn ? "FAQ" : "常见问题",
  }), [isEn]);

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-10 text-slate-900">
      <div className="mx-auto w-full max-w-4xl">
        <Link
          href="/account"
          className="mb-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
        >
          <ArrowLeft size={15} />
          {copy.back}
        </Link>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="text-blue-700" size={22} />
            <h1 className="text-2xl font-bold md:text-3xl">{copy.title}</h1>
          </div>
          <p className="text-sm text-slate-600 md:text-base">{copy.description}</p>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-blue-700">
                <CreditCard size={16} />
                <span className="text-sm font-semibold">{copy.priceLabel}</span>
              </div>
              <p className="text-xl font-bold">{copy.priceText}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-emerald-700">
                <Coins size={16} />
                <span className="text-sm font-semibold">{copy.discountLabel}</span>
              </div>
              <p className="text-xl font-bold">{copy.discountText}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-indigo-700">
                <MessageSquare size={16} />
                <span className="text-sm font-semibold">{copy.communityLabel}</span>
              </div>
              <Link
                href="/account"
                className="inline-flex min-h-9 items-center text-sm font-semibold text-blue-700 underline decoration-blue-500/50 underline-offset-4"
              >
                {copy.communityLink}
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <h2 className="mb-4 text-lg font-bold">{copy.faqTitle}</h2>
          <div className="space-y-4">
            {FAQ_ITEMS.map((item) => (
              <article
                key={item.q_en}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700">
                  <CheckCircle2 size={14} />
                  {isEn ? item.q_en : item.q_zh}
                </h3>
                <p className="text-sm leading-6 text-slate-600">
                  {isEn ? item.a_en : item.a_zh}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
