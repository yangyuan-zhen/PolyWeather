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

const TELEGRAM_GROUP_URL = String(
  process.env.NEXT_PUBLIC_TELEGRAM_GROUP_URL ||
    "https://t.me/+nMG7SjziUKYyZmM1",
).trim();

const FAQ_ITEMS = [
  {
    q_zh: "Pro 包含哪些功能？",
    q_en: "What features does Pro include?",
    a_zh: "开通后可解锁：今日日内机场报文规则分析（含高温时段）、未来日期分析、城市决策卡、全平台智能气象推送。",
    a_en: "Unlocks: intraday METAR rule analysis (including peak window), future-date analysis, city decision cards, and cross-platform smart weather push.",
  },
  {
    q_zh: "当前订阅价格是多少？",
    q_en: "What is the current subscription price?",
    a_zh: "目前仅提供月付：10 USDC / 30 天。",
    a_en: "Monthly plan only: 10 USDC / 30 days.",
  },
  {
    q_zh: "积分如何抵扣？",
    q_en: "How do points work for discounts?",
    a_zh: "满 500 积分起兑，每 500 积分抵 1U，单次最多抵 3U。",
    a_en: "500 points minimum — every 500 points = 1 USDC off, up to 3 USDC discount per payment.",
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
    priceText: "10 USDC / 30 " + (isEn ? "Days" : "天"),
    discountLabel: isEn ? "Points Discount" : "积分抵扣",
    discountText: isEn ? "Up to 3 USDC off" : "最多抵 3U",
    communityLabel: isEn ? "Community Points" : "社群积分",
    communityLink: isEn ? "Join community to earn" : "加入社群即可赚取积分",
    faqTitle: isEn ? "FAQ" : "常见问题",
  }), [isEn]);

  return (
    <main className="min-h-screen bg-[#070d1d] px-4 py-10 text-slate-100">
      <div className="mx-auto w-full max-w-4xl">
        <Link
          href="/account"
          className="mb-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10"
        >
          <ArrowLeft size={15} />
          {copy.back}
        </Link>

        <section className="rounded-3xl border border-blue-400/20 bg-gradient-to-b from-[#162541] to-[#0e1730] p-6 md:p-8">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="text-cyan-300" size={22} />
            <h1 className="text-2xl font-bold md:text-3xl">{copy.title}</h1>
          </div>
          <p className="text-sm text-slate-300 md:text-base">{copy.description}</p>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-cyan-300">
                <CreditCard size={16} />
                <span className="text-sm font-semibold">{copy.priceLabel}</span>
              </div>
              <p className="text-xl font-bold">{copy.priceText}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-emerald-300">
                <Coins size={16} />
                <span className="text-sm font-semibold">{copy.discountLabel}</span>
              </div>
              <p className="text-xl font-bold">{copy.discountText}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-violet-300">
                <MessageSquare size={16} />
                <span className="text-sm font-semibold">{copy.communityLabel}</span>
              </div>
              <Link
                href={TELEGRAM_GROUP_URL}
                target="_blank"
                className="inline-flex min-h-9 items-center text-sm font-semibold text-blue-300 underline decoration-blue-500/50 underline-offset-4"
              >
                {copy.communityLink}
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-[#0f162a]/80 p-6 md:p-8">
          <h2 className="mb-4 text-lg font-bold">{copy.faqTitle}</h2>
          <div className="space-y-4">
            {FAQ_ITEMS.map((item) => (
              <article
                key={item.q_en}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-300">
                  <CheckCircle2 size={14} />
                  {isEn ? item.q_en : item.q_zh}
                </h3>
                <p className="text-sm leading-6 text-slate-300">
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
