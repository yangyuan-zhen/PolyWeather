import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Coins,
  CreditCard,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "PolyWeather | 订阅说明",
  description: "PolyWeather Pro 订阅、积分抵扣与支付方式说明。",
};

const TELEGRAM_GROUP_URL = String(
  process.env.NEXT_PUBLIC_TELEGRAM_GROUP_URL ||
    "https://t.me/+nMG7SjziUKYyZmM1",
).trim();

const FAQ_ITEMS = [
  {
    q: "Pro 包含哪些功能？",
    a: "开通后可解锁：今日日内机场报文规则分析（含高温时段）、历史对账 + 未来日期分析、全平台智能气象推送。",
  },
  {
    q: "当前订阅价格是多少？",
    a: "目前仅提供月付：5 USDC / 30 天。",
  },
  {
    q: "积分如何抵扣？",
    a: "满 500 积分起兑，每 500 积分抵 1U，单次最多抵 3U。",
  },
  {
    q: "支持哪些钱包和支付方式？",
    a: "支持 EVM 浏览器钱包（MetaMask / OKX / Rabby / Bitget 等）及 WalletConnect 扫码钱包（Trust Wallet / Binance Web3 Wallet / TokenPocket 等）。",
  },
];

export default function SubscriptionHelpPage() {
  return (
    <main className="min-h-screen bg-[#070d1d] px-4 py-10 text-slate-100">
      <div className="mx-auto w-full max-w-4xl">
        <Link
          href="/account"
          className="mb-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10"
        >
          <ArrowLeft size={15} />
          返回账户中心
        </Link>

        <section className="rounded-3xl border border-blue-400/20 bg-gradient-to-b from-[#162541] to-[#0e1730] p-6 md:p-8">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="text-cyan-300" size={22} />
            <h1 className="text-2xl font-bold md:text-3xl">PolyWeather Pro 订阅说明</h1>
          </div>
          <p className="text-sm text-slate-300 md:text-base">
            这里是完整的订阅规则和支付说明。你可以先在页面内绑定钱包，再直接开通 Pro。
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-cyan-300">
                <CreditCard size={16} />
                <span className="text-sm font-semibold">订阅价格</span>
              </div>
              <p className="text-xl font-bold">5 USDC / 30 天</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-emerald-300">
                <Coins size={16} />
                <span className="text-sm font-semibold">积分抵扣</span>
              </div>
              <p className="text-xl font-bold">最多抵 3U</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-violet-300">
                <MessageSquare size={16} />
                <span className="text-sm font-semibold">社群积分</span>
              </div>
              <Link
                href={TELEGRAM_GROUP_URL}
                target="_blank"
                className="text-sm font-semibold text-blue-300 underline decoration-blue-500/50 underline-offset-4"
              >
                加入社群即可赚取积分
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-[#0f162a]/80 p-6 md:p-8">
          <h2 className="mb-4 text-lg font-bold">常见问题</h2>
          <div className="space-y-4">
            {FAQ_ITEMS.map((item) => (
              <article
                key={item.q}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-300">
                  <CheckCircle2 size={14} />
                  {item.q}
                </h3>
                <p className="text-sm leading-6 text-slate-300">{item.a}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
