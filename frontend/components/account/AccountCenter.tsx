"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  User as UserIcon,
  Shield,
  Fingerprint,
  Bot,
  RefreshCw,
  LogOut,
  ChevronLeft,
  Copy,
  CheckCircle2,
  UserCheck,
  Mail,
  Hash,
  LogIn,
  Clock,
  Crown,
  ExternalLink,
  Trophy,
  Coins,
  TrendingUp,
  Info,
  Wallet,
  Zap,
  Minus,
  ShieldCheck,
  BarChart3,
  Sparkles,
  ChevronRight,
  Loader2,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";
import {
  getAllowedPaymentHosts,
  getCurrentPaymentHost,
  isPaymentHostAllowed,
} from "@/lib/payment-host";
import { trackAppEvent } from "@/lib/app-analytics";
import { useI18n } from "@/hooks/useI18n";
import { UnlockProOverlay } from "@/components/subscription/UnlockProOverlay";

// --- Types ---

type AuthMeResponse = {
  authenticated?: boolean;
  user_id?: string | null;
  email?: string | null;
  points?: number;
  weekly_points?: number;
  weekly_rank?: number | string | null;
  entitlement_mode?: string | null;
  auth_required?: boolean;
  subscription_required?: boolean;
  subscription_active?: boolean | null;
  subscription_plan_code?: string | null;
  subscription_starts_at?: string | null;
  subscription_expires_at?: string | null;
  subscription_total_expires_at?: string | null;
  subscription_queued_days?: number | null;
  subscription_queued_count?: number | null;
  telegram_pricing?: TelegramPricing | null;
};

type TelegramPricing = {
  configured?: boolean;
  telegram_id?: number | null;
  telegram_status?: string | null;
  is_group_member?: boolean;
  amount_usdc?: string;
  pricing_source?: string;
};

type PaymentPlan = {
  plan_code: string;
  plan_id: number;
  amount_usdc: string;
  duration_days: number;
};

type PaymentTokenOption = {
  code: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  receiver_contract?: string;
  is_default?: boolean;
};

type PointsRedemptionConfig = {
  enabled?: boolean;
  points_per_usdc?: number;
  max_discount_usdc?: number;
};

type PaymentConfig = {
  enabled?: boolean;
  configured?: boolean;
  chain_id?: number;
  token_address?: string;
  token_decimals?: number;
  default_token_address?: string;
  tokens?: PaymentTokenOption[];
  receiver_contract?: string;
  confirmations?: number;
  points_redemption?: PointsRedemptionConfig;
  plans?: PaymentPlan[];
};

type BoundWallet = {
  chain_id: number;
  address: string;
  status: string;
  is_primary: boolean;
  verified_at?: string | null;
};

type CreatedIntent = {
  intent?: {
    intent_id: string;
    order_id_hex: string;
    plan_code: string;
    amount_usdc: string;
    allowed_wallet?: string | null;
  };
  tx_payload?: {
    chain_id: number;
    to: string;
    data: string;
    value: string;
    amount_units: string;
    token_address: string;
    token_symbol?: string;
    token_decimals?: number;
  };
  direct_payment?: {
    chain_id: number;
    chain?: string;
    token_symbol?: string;
    token_address: string;
    token_decimals?: number;
    receiver_address: string;
    amount_units: string;
    amount_usdc: string;
    intent_id: string;
    expires_at: string;
  };
};

type IntentStatusResponse = {
  intent?: {
    intent_id?: string;
    status?: string;
    tx_hash?: string | null;
  };
};

declare global {
  interface Window {
    ethereum?: EvmProvider;
    okxwallet?: {
      ethereum?: EvmProvider;
    };
    okexchain?: EvmProvider;
    rabby?: EvmProvider;
    bitkeep?: {
      ethereum?: EvmProvider;
    };
  }
}

type EvmProvider = {
  request: (args: { method: string; params?: any[] | object }) => Promise<any>;
  providers?: EvmProvider[];
  connect?: (args?: any) => Promise<void>;
  disconnect?: () => Promise<void>;
  session?: unknown;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isBitKeep?: boolean;
};

type ProviderMode = "auto" | "walletconnect";

type ProviderSelection = {
  provider: EvmProvider;
  label: string;
  mode: ProviderMode;
};

type InjectedProviderOption = ProviderSelection & {
  key: string;
};

type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo;
  provider: EvmProvider;
};

type ConnectBindOptions = {
  openOverlayAfterBind?: boolean;
};

type PaymentRecoveryState = {
  intentId: string;
  txHash: string;
  userId: string;
  createdAt: number;
};

const WALLETCONNECT_PROJECT_ID = String(
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
).trim();
const WALLETCONNECT_POLYGON_RPC_URL = String(
  process.env.NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL ||
    "https://polygon-bor-rpc.publicnode.com",
).trim();
const TELEGRAM_GROUP_URL = "https://t.me/+Se93RpNQ58FhYmZh";
const TELEGRAM_BOT_URL = String(
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL || "https://t.me/WeatherQuant_bot",
).trim();
const TELEGRAM_TOPICS_GROUP_URL = TELEGRAM_GROUP_URL;
const SUBSCRIPTION_HELP_HREF = "/subscription-help";
const PAYMENT_RECOVERY_STORAGE_KEY = "polyweather:lastPaymentRecovery";
const PAYMENT_RECOVERY_TTL_MS = 6 * 60 * 60 * 1000;

let walletConnectProviderCache: EvmProvider | null = null;
let walletConnectProviderChainId: number | null = null;
const eip6963Providers = new Map<string, Eip6963ProviderDetail>();

function isWalletConnectResetError(error: unknown): boolean {
  const source = error as any;
  const message = String(
    source?.shortMessage ||
      source?.message ||
      source?.reason ||
      source?.data?.message ||
      source?.cause?.message ||
      source?.error?.message ||
      (error instanceof Error ? error.message : "") ||
      (typeof error === "string" ? error : ""),
  ).toLowerCase();
  return (
    message.includes("connection request reset") ||
    message.includes("pairing aborted") ||
    message.includes("pairing attempt") ||
    message.includes("unable to connect")
  );
}

async function resetWalletConnectProvider(): Promise<void> {
  if (walletConnectProviderCache?.disconnect) {
    try {
      await walletConnectProviderCache.disconnect();
    } catch {
      // ignore
    }
  }
  walletConnectProviderCache = null;
  walletConnectProviderChainId = null;
}

// --- Helpers ---

type InfoRowProps = {
  icon?: LucideIcon;
  label: string;
  value: string;
  isPrimary?: boolean;
};

const InfoRow = ({
  icon: Icon,
  label,
  value,
  isPrimary = false,
}: InfoRowProps) => (
  <div className="flex min-w-0 flex-col gap-3 p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all group sm:flex-row sm:items-center sm:justify-between">
    <div className="flex min-w-0 items-center gap-3">
      <div className="shrink-0 p-2 bg-slate-800 rounded-lg text-slate-400 group-hover:text-blue-400 transition-colors">
        {Icon && <Icon size={18} />}
      </div>
      <span className="min-w-0 text-slate-400 text-sm font-medium leading-5">
        {label}
      </span>
    </div>
    <span
      className={`min-w-0 break-all text-left text-sm font-semibold font-mono sm:text-right ${isPrimary ? "text-blue-400" : "text-slate-200"}`}
    >
      {value}
    </span>
  </div>
);

function formatTime(value: string | undefined | null, locale: string) {
  if (!value) return "--";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "--";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt);
  } catch {
    return "--";
  }
}

function parseSubscriptionExpiry(value: string | undefined | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  const diffMs = dt.getTime() - Date.now();
  return {
    raw,
    date: dt,
    expired: diffMs <= 0,
    daysLeft: Math.ceil(diffMs / 86_400_000),
  };
}

function shortAddress(address: string) {
  const text = String(address || "");
  if (!text.startsWith("0x") || text.length < 12) return text || "--";
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function clearStoredPaymentRecovery() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PAYMENT_RECOVERY_STORAGE_KEY);
}

function getEvmProvider(): EvmProvider | null {
  return listInjectedProviders()[0]?.provider || null;
}

function getEip6963Providers(): Eip6963ProviderDetail[] {
  return Array.from(eip6963Providers.values());
}

function detectWalletLabel(
  provider: EvmProvider | null,
  detail?: Eip6963ProviderDetail,
): string {
  if (!provider && !detail) return "EVM 钱包";
  const announcedName = String(detail?.info?.name || "").trim();
  const announcedRdns = String(detail?.info?.rdns || "").toLowerCase();
  if (
    provider?.isOkxWallet ||
    announcedName.toLowerCase().includes("okx") ||
    announcedRdns.includes("okx")
  ) {
    return "OKX Wallet";
  }
  if (
    provider?.isMetaMask ||
    announcedName.toLowerCase().includes("metamask") ||
    announcedRdns.includes("metamask")
  ) {
    return "MetaMask";
  }
  if (
    provider?.isRabby ||
    announcedName.toLowerCase().includes("rabby") ||
    announcedRdns.includes("rabby")
  ) {
    return "Rabby";
  }
  if (
    provider?.isBitKeep ||
    announcedName.toLowerCase().includes("bitget") ||
    announcedRdns.includes("bitkeep") ||
    announcedRdns.includes("bitget")
  ) {
    return "Bitget Wallet";
  }
  if (announcedName) return announcedName;
  return "EVM 钱包";
}

function collectInjectedProviders(): EvmProvider[] {
  if (typeof window === "undefined") return [];
  const out: EvmProvider[] = [];
  const seen = new Set<EvmProvider>();

  const push = (provider: unknown) => {
    if (!provider || typeof provider !== "object") return;
    const candidate = provider as EvmProvider;
    if (typeof candidate.request !== "function") return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  const root = window.ethereum;
  if (Array.isArray(root?.providers)) {
    root.providers.forEach(push);
  }
  push(root);
  push(window.okxwallet?.ethereum);
  push(window.okexchain);
  push(window.rabby);
  push(window.bitkeep?.ethereum);

  return out;
}

function getInjectedProviderStableId(
  provider: EvmProvider,
  index: number,
  detail?: Eip6963ProviderDetail,
): string {
  const rdns = String(detail?.info?.rdns || "").toLowerCase();
  const announcedName = String(detail?.info?.name || "")
    .toLowerCase()
    .trim();
  if (rdns) return `rdns:${rdns}`;
  if (announcedName) return `name:${announcedName}`;
  if (provider.isOkxWallet || rdns.includes("okx")) return `okx:${index}`;
  if (provider.isMetaMask || rdns.includes("metamask"))
    return `metamask:${index}`;
  if (provider.isRabby || rdns.includes("rabby")) return `rabby:${index}`;
  if (
    provider.isBitKeep ||
    rdns.includes("bitkeep") ||
    rdns.includes("bitget")
  ) {
    return `bitget:${index}`;
  }
  return `evm:${index}`;
}

function listInjectedProviders(): InjectedProviderOption[] {
  const detailByProvider = new Map<EvmProvider, Eip6963ProviderDetail>();
  getEip6963Providers().forEach((detail) => {
    if (detail?.provider && typeof detail.provider.request === "function") {
      detailByProvider.set(detail.provider, detail);
    }
  });
  const candidates = collectInjectedProviders();
  detailByProvider.forEach((_detail, provider) => {
    if (!candidates.includes(provider)) {
      candidates.push(provider);
    }
  });
  const seen = new Set<string>();
  const seenLabels = new Set<string>();
  const out: InjectedProviderOption[] = [];
  candidates.forEach((provider, index) => {
    const detail = detailByProvider.get(provider);
    const label = detectWalletLabel(provider, detail);
    const key = getInjectedProviderStableId(provider, index, detail);
    if (seen.has(key)) return;
    const normalizedLabel = label.trim().toLowerCase();
    if (normalizedLabel && seenLabels.has(normalizedLabel)) return;
    seen.add(key);
    if (normalizedLabel) seenLabels.add(normalizedLabel);
    out.push({
      key,
      provider,
      label,
      mode: "auto",
    });
  });
  return out;
}

function getEvmWalletLabel(provider: EvmProvider | null): string {
  return detectWalletLabel(provider);
}

async function getWalletConnectProvider(
  chainId: number,
  rpcUrl: string,
): Promise<EvmProvider> {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error(
      "WalletConnect 未配置：缺少 NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID。",
    );
  }
  if (walletConnectProviderCache && walletConnectProviderChainId === chainId) {
    return walletConnectProviderCache;
  }
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const rpcMap: Record<number, string> = {
    [chainId]: rpcUrl || WALLETCONNECT_POLYGON_RPC_URL,
  };
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://polyweather-pro.vercel.app";
  const provider = (await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [chainId],
    optionalChains: [chainId],
    showQrModal: true,
    methods: [
      "eth_sendTransaction",
      "personal_sign",
      "eth_signTypedData",
      "eth_signTypedData_v4",
      "eth_sign",
      "eth_call",
      "eth_chainId",
      "eth_accounts",
      "eth_requestAccounts",
    ],
    events: ["accountsChanged", "chainChanged", "disconnect"],
    rpcMap,
    metadata: {
      name: "PolyWeather",
      description: "PolyWeather Pro checkout",
      url: origin,
      icons: [`${origin}/favicon.ico`],
    },
  })) as unknown as EvmProvider;
  walletConnectProviderCache = provider;
  walletConnectProviderChainId = chainId;
  return provider;
}

function toPaddedHex(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

function toPaddedAddress(address: string) {
  return String(address || "")
    .toLowerCase()
    .replace(/^0x/, "")
    .padStart(64, "0");
}

function buildAllowanceCalldata(owner: string, spender: string) {
  return `0xdd62ed3e${toPaddedAddress(owner)}${toPaddedAddress(spender)}`;
}

function buildApproveCalldata(spender: string, amount: bigint) {
  return `0x095ea7b3${toPaddedAddress(spender)}${toPaddedHex(amount)}`;
}

function buildBalanceOfCalldata(owner: string) {
  return `0x70a08231${toPaddedAddress(owner)}`;
}

function formatTokenUnits(amount: bigint, decimals: number) {
  const safeDecimals =
    Number.isFinite(decimals) && decimals >= 0 ? Math.floor(decimals) : 6;
  const base = 10n ** BigInt(safeDecimals);
  const whole = amount / base;
  const fraction = amount % base;
  if (fraction === 0n) return whole.toString();
  const rawFraction = fraction.toString().padStart(safeDecimals, "0");
  const trimmed = rawFraction.replace(/0+$/, "");
  return `${whole.toString()}.${trimmed}`;
}

type NormalizedPaymentError = {
  message: string;
  pending: boolean;
  userRejected: boolean;
};

function normalizePaymentError(error: unknown): NormalizedPaymentError {
  const source = error as any;
  const code = Number(
    source?.code ??
      source?.error?.code ??
      source?.data?.code ??
      source?.cause?.code ??
      NaN,
  );
  const messageCandidates = [
    source?.shortMessage,
    source?.message,
    source?.reason,
    source?.data?.message,
    source?.cause?.message,
    source?.error?.message,
    error instanceof Error ? error.message : "",
    typeof error === "string" ? error : "",
  ];
  const rawMessage = messageCandidates
    .find(
      (item) =>
        typeof item === "string" &&
        item.trim() &&
        item.trim().toLowerCase() !== "[object object]",
    )
    ?.trim();
  const lower = String(rawMessage || "").toLowerCase();

  if (
    lower.includes("confirm pending") ||
    lower.includes("payment pending timeout")
  ) {
    return {
      message: "链上交易已提交，正在确认中，请稍后刷新查看状态。",
      pending: true,
      userRejected: false,
    };
  }

  if (isWalletConnectResetError(error)) {
    return {
      message:
        "WalletConnect 连接已重置，请重新扫码连接；若仍失败，请先在钱包里断开旧连接后再试。",
      pending: false,
      userRejected: false,
    };
  }

  const userRejected =
    code === 4001 ||
    /user rejected|user denied|rejected request|cancelled|canceled|拒绝|取消|签名请求已拒绝/.test(
      lower,
    );
  if (userRejected) {
    return {
      message: "你已取消钱包操作。",
      pending: false,
      userRejected: true,
    };
  }

  const insufficientGas =
    (code === -32000 &&
      /insufficient funds/.test(lower) &&
      /(gas|fee|native|pol|matic)/.test(lower)) ||
    /not enough pol|insufficient (pol|matic)|insufficient funds for gas|network fee|网络费|手续费/.test(
      lower,
    );
  if (insufficientGas) {
    return {
      message: "钱包 POL 不足，无法支付链上手续费，请先充值少量 POL 后重试。",
      pending: false,
      userRejected: false,
    };
  }

  if (rawMessage) {
    return {
      message: rawMessage,
      pending: false,
      userRejected: false,
    };
  }

  try {
    return {
      message: JSON.stringify(error),
      pending: false,
      userRejected: false,
    };
  } catch {
    return {
      message: "发生未知错误，请稍后重试。",
      pending: false,
      userRejected: false,
    };
  }
}

// --- Main Component ---

export function AccountCenter() {
  const router = useRouter();
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const copy = useMemo(
    () => ({
      backHome: isEn ? "Back to Home" : "返回首页",
      accountCenter: isEn ? "Account Center" : "账户中心",
      loadingAccount: isEn ? "Loading account info..." : "加载账户信息中...",
      refresh: isEn ? "Refresh" : "刷新",
      signOut: isEn ? "Sign Out" : "退出",
      signIn: isEn ? "Sign In" : "登录",
      upgradePro: isEn ? "Upgrade Pro" : "升级 Pro",
      guestUser: isEn ? "Guest User" : "游客用户",
      joinedAt: isEn ? "Joined" : "加入时间",
      totalPoints: isEn ? "Total Points" : "总积分 (荣誉)",
      weeklyPoints: isEn ? "Weekly Points" : "本周积分 (竞技)",
      weeklyRank: isEn ? "Weekly Rank" : "周排行 (竞技)",
      weeklyRewards: isEn ? "Weekly Rewards" : "周榜奖励",
      membershipDetails: isEn ? "Membership Details" : "会员权限详情",
      identityStatus: isEn ? "Identity Status" : "身份状态",
      authMode: isEn ? "Auth Mode" : "鉴权模式",
      weatherEngine: isEn ? "Weather Engine" : "气象引擎",
      intradayAnalysis: isEn ? "Intraday Analysis" : "今日内分析",
      historyFuture: isEn
        ? "Future-date + Decision Card Analysis"
        : "未来日期分析 + 城市决策卡",
      smartPush: isEn
        ? "Cross-platform Smart Weather Push"
        : "全平台智能气象查询",
      deepMode: isEn
        ? "Deep mode (incl. high-temp window)"
        : "深度版（含高温时段）",
      compactVisible: isEn ? "Compact visible" : "简版可见",
      enabled: isEn ? "Enabled" : "已开启",
      locked: isEn ? "Locked" : "锁定",
      boundEmail: isEn ? "Bound Email" : "绑定邮箱",
      loginMethod: isEn ? "Sign-in Method" : "登录方式",
      renewalDate: isEn ? "Renewal Date" : "续费日期",
      accessUntil: isEn ? "Access Until" : "可用至",
      authResult: isEn ? "Auth Result" : "鉴权结果",
      passed: isEn ? "Passed" : "通过",
      restricted: isEn ? "Restricted" : "受限",
      telegramBind: isEn ? "Telegram Bot Binding" : "Telegram Bot 绑定",
      telegramHint: isEn
        ? "Use one-click Telegram binding first to sync notifications and access. After binding, refresh this page and submit your Telegram group join request."
        : "优先使用「一键绑定 Telegram Bot」同步通知与权限。绑定完成后刷新本页，再提交 Telegram 群组入群申请。",
      telegramFallbackHint: isEn
        ? "Fallback copy method: only use this if one-click binding does not open Telegram correctly. Copy the command below and send it to @WeatherQuant_bot. After binding, refresh this page to show the group entry."
        : "兜底复制方式：仅在一键绑定无法正常打开 Telegram 时使用。请复制下方命令并发送给 @WeatherQuant_bot。绑定完成后刷新本页，即可显示入群入口。",
      paymentManualSupport: isEn
        ? "If payment succeeds but Pro is still not activated, email yhrsc30@gmail.com. This project is currently maintained by one developer, so manual recovery may be needed in edge cases."
        : "如果付款成功后 Pro 仍未开通，请发邮件到 yhrsc30@gmail.com。当前项目由我一人维护，极少数边缘情况可能需要人工补开。给你带来的不便，敬请谅解！",
      telegramBotLink: isEn
        ? "Open Bot (@WeatherQuant_bot)"
        : "打开机器人 (@WeatherQuant_bot)",
      telegramBotBindLink: isEn ? "One-click Telegram Binding" : "一键绑定 Telegram Bot",
      telegramGroupLink: isEn ? "Join Telegram Group" : "加入 Telegram 群组",
      telegramTopicsGroupLink: isEn
        ? "Real-time Weather Updates"
        : "城市实测温度群",
      copyCommand: isEn ? "Copy fallback command" : "复制兜底命令",
      paymentMgmt: isEn ? "Payment Management" : "支付管理",
      paymentToken: isEn ? "Payment Token" : "支付币种",
      paymentAccount: isEn ? "Subscription Account" : "订阅归属账号",
      paymentWallet: isEn ? "Paying Wallet" : "付款钱包",
      paymentReceiver: isEn ? "Receiver Contract" : "当前收款合约",
      paymentHost: isEn ? "Payment Host" : "支付域名",
      primary: "Primary",
      polygonChain: "Polygon Chain",
      noWallet: isEn ? "No payout wallet bound yet." : "未绑定任何收件钱包",
      bindExt: isEn
        ? "Bind Browser Wallet (EVM Extension)"
        : "绑定浏览器钱包（EVM扩展）",
      bindQr: isEn
        ? "Bind via QR (WalletConnect)"
        : "扫码绑定（WalletConnect）",
      walletConnectMissing: isEn
        ? "WalletConnect disabled: please configure"
        : "未启用 WalletConnect：请配置",
      walletExtensionDetected: isEn
        ? "Detected browser wallets"
        : "检测到的浏览器钱包",
      walletExtensionChoose: isEn
        ? "Choose extension wallet"
        : "选择浏览器钱包",
      walletRecoveryBusy: isEn
        ? "Recovering Pro entitlement after on-chain payment..."
        : "正在根据链上支付恢复 Pro 权限...",
      walletRecoveryDone: isEn
        ? "Pro entitlement recovered."
        : "Pro 权限已恢复。",
      walletRecoveryFailed: isEn
        ? "A recent on-chain payment is still syncing to your subscription. Please refresh in a minute or contact support."
        : "检测到最近的链上支付流程，但订阅状态仍在同步中。请稍后刷新，或联系管理员处理。",
      unbind: isEn ? "Unbind" : "解绑",
      unbindConfirm: isEn
        ? "Unbind wallet {address}? You can bind it again later."
        : "确认解绑钱包 {address}？后续可重新绑定。",
      unbindDone: isEn ? "Wallet unbound." : "钱包已解绑。",
      unbindDonePrimary: isEn
        ? "Wallet unbound. New primary: {address}"
        : "钱包已解绑，新的主钱包：{address}",
      unbindFailed: isEn ? "Failed to unbind wallet" : "解绑钱包失败",
      authExpired: isEn
        ? "Session expired. Please sign out and sign in again."
        : "登录会话已失效，请退出后重新登录。",
      payNow: isEn ? "Subscribe & Activate" : "立即订阅并激活服务",
      connectAndPay: isEn ? "Connect Wallet & Pay" : "连接钱包并支付",
      loginBeforeBind: isEn
        ? "Please sign in before binding wallet."
        : "请先登录后再绑定钱包。",
      loginBeforePay: isEn
        ? "Please sign in before payment."
        : "请先登录后再支付。",
      bindFirstBeforePay: isEn
        ? "Please bind a wallet first."
        : "请先绑定钱包。",
      payNotReady: isEn
        ? "Payment service is not fully configured."
        : "支付服务未配置完成。",
      paymentHostBlocked: isEn
        ? "Payments are disabled on this host. Please return to the production site: {host}"
        : "当前域名不允许发起支付，请回到主站后重试：{host}",
      paymentGuardHint: isEn
        ? "Payment will be credited to the current account and bound wallet shown below."
        : "支付将记入下方显示的当前账号和绑定钱包，请先核对。",
      openBindFlow: isEn
        ? "Please bind a wallet first. Opening bind flow..."
        : "请先完成钱包绑定，正在拉起绑定流程...",
      walletBoundCreatingOrder: isEn
        ? "Wallet bound. Creating order and sending payment..."
        : "钱包已绑定，正在创建订单并发起支付...",
      proMember: "PRO MEMBER",
      freeTier: "FREE TIER",
      proPendingSync: isEn ? "Activated (pending sync)" : "已开通（待同步）",
      noProSubscription: isEn ? "No Pro subscription" : "暂无 Pro 订阅",
      trialEndsSoonTitle: isEn ? "Trial ending soon" : "试用即将结束",
      trialEndsSoonBody: isEn
        ? "Your 3-day trial is almost over. Upgrade to Pro to keep full intraday analysis and decision cards."
        : "你的 3 天试用即将结束。升级 Pro 后可继续使用完整日内分析和城市决策卡。",
      trialExpiredTitle: isEn ? "Trial ended" : "试用已结束",
      trialExpiredBody: isEn
        ? "Your trial access has ended. Renew with Pro to restore full access."
        : "试用权限已结束。开通 Pro 后可恢复完整权限。",
      proEndsSoonTitle: isEn ? "Pro renewal due soon" : "Pro 即将到期",
      proEndsSoonBody: isEn
        ? "Your Pro membership will expire soon. Renew now to avoid interruption."
        : "你的 Pro 会员即将到期。现在续费可避免权限中断。",
      proExpiredTitle: isEn ? "Pro expired" : "Pro 已到期",
      proExpiredBody: isEn
        ? "Your Pro membership has expired. Renew now to restore premium access."
        : "你的 Pro 会员已到期。立即续费可恢复高级权限。",
      renewNow: isEn ? "Renew Now" : "立即续费",
      trialBadge: isEn ? "TRIAL" : "试用中",
      daysLeft: isEn ? "{days} days left" : "剩余 {days} 天",
      queuedExtensionSummary: isEn
        ? "Current plan until {current}. Queued extension: +{days} days. Total access until {total}."
        : "当前订阅至 {current}，已排队延长 +{days} 天，总可用至 {total}。",
    }),
    [isEn],
  );

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [copied, setCopied] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [usePoints, setUsePoints] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [user, setUser] = useState<User | null>(null);
  const [backend, setBackend] = useState<AuthMeResponse | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(
    null,
  );
  const [boundWallets, setBoundWallets] = useState<BoundWallet[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [selectedPlanCode, setSelectedPlanCode] = useState("pro_monthly");
  const [selectedTokenAddress, setSelectedTokenAddress] = useState("");
  const [selectedWallet, setSelectedWallet] = useState("");
  const [providerMode, setProviderMode] = useState<ProviderMode>("auto");
  const [injectedProviderOptions, setInjectedProviderOptions] = useState<
    InjectedProviderOption[]
  >([]);
  const [selectedInjectedProviderKey, setSelectedInjectedProviderKey] =
    useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [lastIntentId, setLastIntentId] = useState("");
  const [lastTxHash, setLastTxHash] = useState("");
  const [telegramBindOpening, setTelegramBindOpening] = useState(false);
  const [manualPayment, setManualPayment] = useState<
    CreatedIntent["direct_payment"] | null
  >(null);
  const [manualTxHash, setManualTxHash] = useState("");
  const [lastPaymentStartedAt, setLastPaymentStartedAt] = useState(0);
  const [showSecondarySections, setShowSecondarySections] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);

  const supabaseReady = hasSupabasePublicEnv();
  const walletConnectEnabled = Boolean(WALLETCONNECT_PROJECT_ID);
  const authUserId = backend?.user_id || user?.id || "";
  const authIsAuthenticated = Boolean(authUserId);
  const paymentReadyForRecovery = Boolean(
    paymentConfig?.enabled && paymentConfig?.configured,
  );
  const hasRecentPaymentRecovery =
    Boolean(lastIntentId && lastTxHash && authUserId && lastPaymentStartedAt) &&
    Date.now() - lastPaymentStartedAt <= PAYMENT_RECOVERY_TTL_MS;
  const allowedPaymentHosts = useMemo(() => getAllowedPaymentHosts(), []);
  const currentPaymentHost = useMemo(() => getCurrentPaymentHost(), []);
  const paymentHostAllowed = useMemo(
    () => isPaymentHostAllowed(currentPaymentHost),
    [currentPaymentHost],
  );

  useEffect(() => {
    let canceled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const win = typeof window !== "undefined" ? (window as any) : null;

    const reveal = () => {
      if (!canceled) {
        setShowSecondarySections(true);
      }
    };

    if (win && typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(reveal, { timeout: 320 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(reveal, 140);
    } else {
      setShowSecondarySections(true);
    }

    return () => {
      canceled = true;
      if (
        win &&
        idleId != null &&
        typeof win.cancelIdleCallback === "function"
      ) {
        win.cancelIdleCallback(idleId);
      }
      if (timeoutId != null && typeof window !== "undefined") {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    const syncProviders = () => {
      const nextOptions = listInjectedProviders();
      setInjectedProviderOptions(nextOptions);
      setSelectedInjectedProviderKey((current) => {
        if (current && nextOptions.some((row) => row.key === current)) {
          return current;
        }
        return nextOptions[0]?.key || "";
      });
    };

    const handleAnnounce = (event: Event) => {
      const customEvent = event as CustomEvent<Eip6963ProviderDetail>;
      const detail = customEvent.detail;
      if (!detail?.provider || typeof detail.provider.request !== "function") {
        return;
      }
      const uuid = String(detail.info?.uuid || "").trim();
      const fallbackKey = `${String(detail.info?.rdns || "wallet").toLowerCase()}:${String(
        detail.info?.name || "wallet",
      ).toLowerCase()}`;
      eip6963Providers.set(uuid || fallbackKey, detail);
      syncProviders();
    };

    syncProviders();
    if (typeof window === "undefined") return;
    window.addEventListener(
      "eip6963:announceProvider",
      handleAnnounce as EventListener,
    );
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.addEventListener(
      "ethereum#initialized",
      syncProviders as EventListener,
      {
        once: false,
      },
    );
    return () => {
      window.removeEventListener(
        "eip6963:announceProvider",
        handleAnnounce as EventListener,
      );
      window.removeEventListener(
        "ethereum#initialized",
        syncProviders as EventListener,
      );
    };
  }, []);

  /**
   * Returns a valid access token, refreshing the session if the stored one
   * is missing or close to expiry. Throws if the user is not authenticated.
   */
  const getValidAccessToken = useCallback(async (): Promise<string> => {
    if (!supabaseReady)
      throw new Error(
        isEn
          ? "Supabase is not configured. Unable to get auth token."
          : "Supabase 未配置，无法获取登录凭证。",
      );
    const client = getSupabaseBrowserClient();
    // First try the cached session.
    const {
      data: { session: cached },
    } = await client.auth.getSession();
    const cachedToken = String(cached?.access_token || "").trim();
    const expiresAtSec = Number(cached?.expires_at || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    const refreshLeadSec = 90;
    if (
      cachedToken &&
      Number.isFinite(expiresAtSec) &&
      expiresAtSec > nowSec + refreshLeadSec
    ) {
      return cachedToken;
    }
    if (cachedToken && (!Number.isFinite(expiresAtSec) || expiresAtSec <= 0)) {
      return cachedToken;
    }
    // Session missing or expired — force a refresh.
    const {
      data: { session: refreshed },
      error,
    } = await client.auth.refreshSession();
    const refreshedToken = String(refreshed?.access_token || "").trim();
    if (refreshedToken) return refreshedToken;
    if (cachedToken && Number.isFinite(expiresAtSec) && expiresAtSec > nowSec) {
      return cachedToken;
    }
    throw new Error(
      error?.message
        ? isEn
          ? `Session expired (${error.message}). Please sign out and sign in again.`
          : `登录会话已失效 (${error.message})，请退出后重新登录。`
        : isEn
          ? "Session expired. Please sign out and sign in again."
          : "登录会话已失效，请退出后重新登录。",
    );
  }, [isEn, supabaseReady]);

  const buildAuthedHeaders = useCallback(
    async (
      withJson = false,
      requireAuth = false,
    ): Promise<Record<string, string>> => {
      const headers: Record<string, string> = {};
      if (withJson) headers["Content-Type"] = "application/json";
      if (!supabaseReady) return headers;
      try {
        const token = await getValidAccessToken();
        headers.Authorization = `Bearer ${token}`;
      } catch (error) {
        if (requireAuth) throw error;
        // Best-effort fallback: use current cached session token (if any)
        // even when refresh failed, so same-origin API routes can still auth.
        try {
          const {
            data: { session },
          } = await getSupabaseBrowserClient().auth.getSession();
          const fallbackToken = String(session?.access_token || "").trim();
          if (fallbackToken) {
            headers.Authorization = `Bearer ${fallbackToken}`;
          }
        } catch {
          // Non-authenticated page load — silently skip.
        }
      }
      return headers;
    },
    [supabaseReady, getValidAccessToken],
  );

  const resolvePaymentProvider = useCallback(
    async (
      mode: ProviderMode = "auto",
      preferredInjectedKey = "",
    ): Promise<ProviderSelection> => {
      const targetChainId = Number(paymentConfig?.chain_id || 137);
      if (mode !== "walletconnect") {
        const injectedOptions = listInjectedProviders();
        const injected =
          injectedOptions.find((row) => row.key === preferredInjectedKey)
            ?.provider || getEvmProvider();
        const label =
          injectedOptions.find((row) => row.key === preferredInjectedKey)
            ?.label || getEvmWalletLabel(injected);
        if (injected) {
          return {
            provider: injected,
            label,
            mode: "auto",
          };
        }
      }
      if (!walletConnectEnabled) {
        throw new Error(
          "未检测到浏览器扩展钱包，且 WalletConnect 未启用。请配置 NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID 或安装 EVM 钱包扩展。",
        );
      }
      const wcProvider = await getWalletConnectProvider(
        targetChainId,
        WALLETCONNECT_POLYGON_RPC_URL,
      );
      const existingAccounts = (await wcProvider
        .request({ method: "eth_accounts" })
        .catch(() => [])) as string[];
      if (!Array.isArray(existingAccounts) || existingAccounts.length === 0) {
        if (typeof wcProvider.connect === "function") {
          try {
            await wcProvider.connect({ chains: [targetChainId] });
          } catch (err) {
            if (!isWalletConnectResetError(err)) throw err;
            await resetWalletConnectProvider();
            const freshProvider = await getWalletConnectProvider(
              targetChainId,
              WALLETCONNECT_POLYGON_RPC_URL,
            );
            if (typeof freshProvider.connect === "function") {
              await freshProvider.connect({ chains: [targetChainId] });
            }
            return {
              provider: freshProvider,
              label: "WalletConnect",
              mode: "walletconnect",
            };
          }
        }
      }
      return {
        provider: wcProvider,
        label: "WalletConnect",
        mode: "walletconnect",
      };
    },
    [paymentConfig?.chain_id, walletConnectEnabled],
  );

  const loadPaymentSnapshot = useCallback(async () => {
    if (!backend?.authenticated) {
      setPaymentConfig(null);
      setBoundWallets([]);
      return;
    }
    try {
      const authHeadersPromise = buildAuthedHeaders(false);
      const [configRes, walletsRes] = await Promise.all([
        authHeadersPromise.then((headers) =>
          fetch("/api/payments/config", {
            cache: "no-store",
            headers,
          }),
        ),
        authHeadersPromise.then((headers) =>
          fetch("/api/payments/wallets", {
            cache: "no-store",
            headers,
          }),
        ),
      ]);
      if (configRes.ok) {
        const configJson = (await configRes.json()) as PaymentConfig;
        setPaymentConfig(configJson);
        if (!selectedPlanCode && configJson.plans?.length) {
          setSelectedPlanCode(configJson.plans[0].plan_code);
        }
        const tokenOptions = Array.isArray(configJson.tokens)
          ? configJson.tokens.filter(
              (row) =>
                typeof row?.address === "string" &&
                String(row.address).startsWith("0x"),
            )
          : [];
        const defaultTokenAddress = String(
          configJson.default_token_address ||
            tokenOptions.find((row) => row.is_default)?.address ||
            tokenOptions[0]?.address ||
            configJson.token_address ||
            "",
        ).toLowerCase();
        if (defaultTokenAddress) {
          setSelectedTokenAddress((prev) => prev || defaultTokenAddress);
        }
      }
      if (walletsRes.ok) {
        const walletsJson = (await walletsRes.json()) as {
          wallets?: BoundWallet[];
        };
        const wallets = (
          Array.isArray(walletsJson.wallets) ? walletsJson.wallets : []
        )
          .filter((row) => {
            const status = String(row?.status || "active").toLowerCase();
            const address = String(row?.address || "");
            return status === "active" && address.startsWith("0x");
          })
          .map((row) => ({
            ...row,
            address: String(row.address || "").toLowerCase(),
          }));
        setBoundWallets(wallets);
        if (wallets.length) {
          const currentSelected = String(selectedWallet || "").toLowerCase();
          const hasCurrent = wallets.some(
            (row) =>
              String(row.address || "").toLowerCase() === currentSelected,
          );
          const fallback =
            wallets.find((row) => Boolean(row.is_primary))?.address ||
            wallets[0].address;
          if (!currentSelected || !hasCurrent) {
            setSelectedWallet(fallback);
          }
          const currentWalletAddress = String(
            walletAddress || "",
          ).toLowerCase();
          const hasWalletAddress = wallets.some(
            (row) =>
              String(row.address || "").toLowerCase() === currentWalletAddress,
          );
          if (!currentWalletAddress || !hasWalletAddress) {
            setWalletAddress(fallback);
          }
        } else {
          setSelectedWallet("");
          setWalletAddress("");
        }
      }
    } catch {
      // ignore
    }
  }, [
    backend?.authenticated,
    buildAuthedHeaders,
    selectedPlanCode,
    selectedWallet,
    walletAddress,
  ]);

  const fetchLatestPaymentConfig = useCallback(
    async (
      authHeaders?: Record<string, string>,
      syncState = true,
    ): Promise<PaymentConfig> => {
      const headers = authHeaders || (await buildAuthedHeaders(false));
      const configRes = await fetch("/api/payments/config", {
        cache: "no-store",
        headers,
      });
      if (!configRes.ok) {
        const raw = (await configRes.text()).slice(0, 350);
        throw new Error(`load payment config failed: ${raw}`);
      }
      const configJson = (await configRes.json()) as PaymentConfig;
      if (syncState) {
        setPaymentConfig(configJson);
        if (!selectedPlanCode && configJson.plans?.length) {
          setSelectedPlanCode(configJson.plans[0].plan_code);
        }
        const tokenOptions = Array.isArray(configJson.tokens)
          ? configJson.tokens.filter(
              (row) =>
                typeof row?.address === "string" &&
                String(row.address).startsWith("0x"),
            )
          : [];
        const defaultTokenAddress = String(
          configJson.default_token_address ||
            tokenOptions.find((row) => row.is_default)?.address ||
            tokenOptions[0]?.address ||
            configJson.token_address ||
            "",
        ).toLowerCase();
        if (defaultTokenAddress) {
          setSelectedTokenAddress((prev) => prev || defaultTokenAddress);
        }
      }
      return configJson;
    },
    [buildAuthedHeaders, selectedPlanCode],
  );

  const loadSnapshot = useCallback(async () => {
    setErrorText("");
    try {
      const userPromise = supabaseReady
        ? getSupabaseBrowserClient().auth.getUser()
        : Promise.resolve({ data: { user: null as User | null } });
      const authHeadersPromise = buildAuthedHeaders(false);
      const backendPromise = authHeadersPromise.then((headers) =>
        fetch("/api/auth/me", {
          cache: "no-store",
          headers,
        }),
      );
      const [userResult, backendResult] = await Promise.all([
        userPromise,
        backendPromise,
      ]);
      setUser(userResult.data?.user ?? null);
      if (!backendResult.ok) {
        const raw = (await backendResult.text()).slice(0, 260);
        throw new Error(`HTTP ${backendResult.status} ${raw}`.trim());
      }
      const backendJson = (await backendResult.json()) as AuthMeResponse;
      setBackend(backendJson);
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      setErrorText(String(error));
    }
  }, [buildAuthedHeaders, supabaseReady]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      await loadSnapshot();
      if (!cancelled) setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    void loadPaymentSnapshot();
  }, [loadPaymentSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!(lastIntentId && lastTxHash && authUserId && lastPaymentStartedAt)) {
      clearStoredPaymentRecovery();
      return;
    }
    const payload: PaymentRecoveryState = {
      intentId: lastIntentId,
      txHash: lastTxHash,
      userId: authUserId,
      createdAt: lastPaymentStartedAt,
    };
    window.sessionStorage.setItem(
      PAYMENT_RECOVERY_STORAGE_KEY,
      JSON.stringify(payload),
    );
  }, [authUserId, lastIntentId, lastPaymentStartedAt, lastTxHash]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authUserId) return;
    if (lastIntentId && lastTxHash && lastPaymentStartedAt) return;
    const raw = window.sessionStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PaymentRecoveryState;
      const userId = String(parsed?.userId || "").trim();
      const intentId = String(parsed?.intentId || "").trim();
      const txHash = String(parsed?.txHash || "")
        .trim()
        .toLowerCase();
      const createdAt = Number(parsed?.createdAt || 0);
      const expired =
        !createdAt || Date.now() - createdAt > PAYMENT_RECOVERY_TTL_MS;
      if (expired || !intentId || !txHash || !userId || userId !== authUserId) {
        clearStoredPaymentRecovery();
        return;
      }
      setLastIntentId(intentId);
      setLastTxHash(txHash);
      setLastPaymentStartedAt(createdAt);
    } catch {
      clearStoredPaymentRecovery();
    }
  }, [authUserId, lastIntentId, lastPaymentStartedAt, lastTxHash]);

  useEffect(() => {
    if (!backend?.subscription_active) return;
    setLastIntentId("");
    setLastTxHash("");
    setManualPayment(null);
    setManualTxHash("");
    setLastPaymentStartedAt(0);
    clearStoredPaymentRecovery();
  }, [backend?.subscription_active]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSnapshot();
    await loadPaymentSnapshot();
    setRefreshing(false);
  };

  const reconcileLatestPayment = useCallback(async () => {
    if (!authIsAuthenticated || reconcileBusy) return false;
    setReconcileBusy(true);
    try {
      const headers = await buildAuthedHeaders(true, true);
      const res = await fetch("/api/payments/reconcile-latest", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        return false;
      }
      const json = (await res.json()) as {
        ok?: boolean;
        action?: string;
        subscription?: { plan_code?: string | null } | null;
      };
      if (json.ok) {
        setPaymentInfo(copy.walletRecoveryDone);
        setPaymentError("");
        await loadSnapshot();
        await loadPaymentSnapshot();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setReconcileBusy(false);
    }
  }, [
    authIsAuthenticated,
    buildAuthedHeaders,
    copy.walletRecoveryDone,
    loadPaymentSnapshot,
    loadSnapshot,
    reconcileBusy,
  ]);

  useEffect(() => {
    if (!authIsAuthenticated) return;
    if (backend?.subscription_active) return;
    if (!paymentReadyForRecovery) return;
    if (!hasRecentPaymentRecovery) return;
    let cancelled = false;
    const run = async () => {
      setPaymentInfo(copy.walletRecoveryBusy);
      const repaired = await reconcileLatestPayment();
      if (cancelled) return;
      if (!repaired && !backend?.subscription_active) {
        setPaymentInfo("");
        setPaymentError(copy.walletRecoveryFailed);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    backend?.subscription_active,
    authIsAuthenticated,
    copy.walletRecoveryBusy,
    copy.walletRecoveryFailed,
    hasRecentPaymentRecovery,
    paymentReadyForRecovery,
    reconcileLatestPayment,
  ]);

  const onSignOut = async () => {
    setLastIntentId("");
    setLastTxHash("");
    setLastPaymentStartedAt(0);
    clearStoredPaymentRecovery();
    if (walletConnectProviderCache?.disconnect) {
      try {
        await walletConnectProviderCache.disconnect();
      } catch {
        // ignore
      }
      walletConnectProviderCache = null;
      walletConnectProviderChainId = null;
    }
    if (supabaseReady) {
      try {
        await getSupabaseBrowserClient().auth.signOut();
      } catch {
        // ignore
      }
    }
    router.replace("/");
  };

  // --- Derived State ---
  const userId = backend?.user_id || user?.id || "";
  const isAuthenticated = Boolean(userId);
  const email = backend?.email || user?.email || "";
  // Handle ?bind_token=xxx from Telegram bot /bind deep link
  useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("bind_token");
    if (!token) return;
    // Remove token from URL so refresh doesn't retry
    const url = new URL(window.location.href);
    url.searchParams.delete("bind_token");
    window.history.replaceState(null, "", url.toString());
    (async () => {
      setPaymentError("");
      setPaymentInfo("");
      try {
        const authHeaders = await buildAuthedHeaders(true, false);
        const res = await fetch("/api/auth/telegram/bind-by-token", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          const raw = (await res.text()).slice(0, 350);
          throw new Error(`bind failed: ${raw}`);
        }
        const data = (await res.json()) as {
          telegram_pricing?: TelegramPricing | null;
        };
        if (data.telegram_pricing?.is_group_member) {
          const amount = data.telegram_pricing.amount_usdc || "5";
          setPaymentInfo(`Telegram 群成员验证成功，当前会员价 ${amount}U。`);
        }
        await loadSnapshot();
        await loadPaymentSnapshot();
      } catch (error) {
        setPaymentError(normalizePaymentError(error).message);
      }
    })();
  }, [isAuthenticated, buildAuthedHeaders, loadPaymentSnapshot, loadSnapshot]);
  const displayName =
    String(user?.user_metadata?.full_name || "").trim() ||
    (email ? String(email).split("@")[0] : "") ||
    copy.guestUser;
  const initials = (displayName.slice(0, 2) || "PW").toUpperCase();
  const joinedAt = formatTime(user?.created_at, locale);
  const isSubscribed = Boolean(backend?.subscription_active);
  const planCode = String(backend?.subscription_plan_code || "").trim();
  const isTrialPlan = /trial/i.test(planCode);
  const currentExpiryRaw = String(
    backend?.subscription_expires_at || user?.user_metadata?.pro_expiry || "",
  ).trim();
  const totalExpiryRaw = String(
    backend?.subscription_total_expires_at ||
      backend?.subscription_expires_at ||
      user?.user_metadata?.pro_expiry ||
      "",
  ).trim();
  const queuedExtensionDays = Math.max(
    0,
    Number(backend?.subscription_queued_days || 0),
  );
  const hasQueuedExtension = Boolean(isSubscribed && queuedExtensionDays > 0);
  const canAccessPaidTelegramGroup = Boolean(
    isSubscribed && (!isTrialPlan || hasQueuedExtension),
  );
  const telegramBound = Number(backend?.telegram_pricing?.telegram_id || 0) > 0;
  const displayExpiryRaw = isSubscribed ? totalExpiryRaw : currentExpiryRaw;
  const reminderExpiryRaw = isSubscribed
    ? totalExpiryRaw
    : currentExpiryRaw || totalExpiryRaw;
  const expiryInfo = parseSubscriptionExpiry(reminderExpiryRaw);
  const expiryFormatted = formatTime(displayExpiryRaw, locale);
  const currentExpiryFormatted = formatTime(currentExpiryRaw, locale);
  const totalExpiryFormatted = formatTime(totalExpiryRaw, locale);
  const proExpiry = isSubscribed
    ? expiryFormatted !== "--"
      ? expiryFormatted
      : displayExpiryRaw || copy.proPendingSync
    : copy.noProSubscription;
  const showExpiringSoon = Boolean(
    isSubscribed &&
    !hasQueuedExtension &&
    expiryInfo &&
    !expiryInfo.expired &&
    expiryInfo.daysLeft <= 3,
  );
  const showExpiredReminder = Boolean(
    !isSubscribed && expiryInfo && expiryInfo.expired,
  );
  const paymentFeatureReady = paymentReadyForRecovery;
  const canOpenCheckoutOverlay = Boolean(
    paymentFeatureReady &&
    (!isSubscribed || isTrialPlan || showExpiringSoon || showExpiredReminder),
  );
  const subscriptionStatusTitle = showExpiredReminder
    ? isTrialPlan
      ? copy.trialExpiredTitle
      : copy.proExpiredTitle
    : showExpiringSoon
      ? isTrialPlan
        ? copy.trialEndsSoonTitle
        : copy.proEndsSoonTitle
      : "";
  const subscriptionStatusBody = showExpiredReminder
    ? isTrialPlan
      ? copy.trialExpiredBody
      : copy.proExpiredBody
    : showExpiringSoon
      ? isTrialPlan
        ? copy.trialEndsSoonBody
        : copy.proEndsSoonBody
      : "";
  const subscriptionStatusMeta =
    expiryInfo && (showExpiringSoon || showExpiredReminder)
      ? `${formatTime(expiryInfo.raw, locale)} · ${copy.daysLeft.replace("{days}", String(Math.max(expiryInfo.daysLeft, 0)))}`
      : "";
  const queuedExtensionSummary = hasQueuedExtension
    ? copy.queuedExtensionSummary
        .replace("{current}", currentExpiryFormatted)
        .replace("{days}", String(queuedExtensionDays))
        .replace("{total}", totalExpiryFormatted)
    : "";
  const expiryLabel = hasQueuedExtension ? copy.accessUntil : copy.renewalDate;

  useEffect(() => {
    if (!showOverlay || !canOpenCheckoutOverlay) return;
    trackAppEvent("paywall_viewed", {
      entry: "account_center",
      user_state: isAuthenticated ? "logged_in" : "guest",
      expired: showExpiredReminder,
      expiring_soon: showExpiringSoon,
      subscription_plan_code: planCode || null,
    });
  }, [
    isAuthenticated,
    canOpenCheckoutOverlay,
    planCode,
    showExpiredReminder,
    showExpiringSoon,
    showOverlay,
  ]);

  // Points Logic
  const backendPointsRaw = Number(backend?.points);
  const metadataPointsRaw = Number(
    user?.user_metadata?.points ?? user?.user_metadata?.total_points ?? 0,
  );
  const metadataPointsSafe = Number.isFinite(metadataPointsRaw)
    ? metadataPointsRaw
    : 0;
  const pointsRaw = Number.isFinite(backendPointsRaw)
    ? Math.max(backendPointsRaw, metadataPointsSafe)
    : metadataPointsSafe;
  const backendWeeklyPointsRaw = Number(backend?.weekly_points);
  const metadataWeeklyPointsRaw = Number(
    user?.user_metadata?.weekly_points ?? 0,
  );
  const weeklyPointsRaw = Number.isFinite(backendWeeklyPointsRaw)
    ? backendWeeklyPointsRaw
    : metadataWeeklyPointsRaw;
  const weeklyRankRaw =
    backend?.weekly_rank ?? user?.user_metadata?.weekly_rank;
  const totalPoints = Number.isFinite(pointsRaw) ? Math.max(0, pointsRaw) : 0;
  const weeklyPoints = Number.isFinite(weeklyPointsRaw)
    ? Math.max(0, weeklyPointsRaw)
    : 0;
  const weeklyRank = weeklyRankRaw == null ? "--" : String(weeklyRankRaw);

  const planList = paymentConfig?.plans || [];
  const monthlyPlanList = planList.filter(
    (plan) =>
      String(plan.plan_code || "")
        .trim()
        .toLowerCase() === "pro_monthly",
  );
  const effectivePlanList = monthlyPlanList.length ? monthlyPlanList : planList;
  const selectedPlan =
    effectivePlanList.find((plan) => plan.plan_code === selectedPlanCode) ||
    effectivePlanList[0];
  const availableTokenList: PaymentTokenOption[] = useMemo(() => {
    const configured = Array.isArray(paymentConfig?.tokens)
      ? paymentConfig?.tokens || []
      : [];
    const clean = configured
      .filter(
        (row) =>
          row &&
          typeof row.address === "string" &&
          row.address.startsWith("0x"),
      )
      .map((row) => ({
        ...row,
        address: String(row.address).toLowerCase(),
        symbol: String(row.symbol || "USDC"),
        name: String(row.name || row.symbol || "USDC"),
        code: String(row.code || "usdc"),
        decimals: Number.isFinite(Number(row.decimals))
          ? Number(row.decimals)
          : Number(paymentConfig?.token_decimals ?? 6),
      }));
    if (clean.length) return clean;
    const fallbackAddress = String(
      paymentConfig?.token_address || "",
    ).toLowerCase();
    if (!fallbackAddress.startsWith("0x")) return [];
    return [
      {
        code: "usdc",
        symbol: "USDC",
        name: "USDC",
        address: fallbackAddress,
        decimals: Number(paymentConfig?.token_decimals ?? 6),
        receiver_contract: paymentConfig?.receiver_contract,
        is_default: true,
      },
    ];
  }, [paymentConfig]);
  const resolvedSelectedTokenAddress = String(
    selectedTokenAddress ||
      paymentConfig?.default_token_address ||
      availableTokenList.find((row) => row.is_default)?.address ||
      availableTokenList[0]?.address ||
      paymentConfig?.token_address ||
      "",
  ).toLowerCase();
  const selectedPaymentToken =
    availableTokenList.find(
      (row) => row.address === resolvedSelectedTokenAddress,
    ) || availableTokenList[0];
  const selectedTokenLabel =
    selectedPaymentToken?.symbol ||
    (resolvedSelectedTokenAddress.startsWith("0x")
      ? shortAddress(resolvedSelectedTokenAddress)
      : "USDC");
  const paymentReceiverAddress = String(
    selectedPaymentToken?.receiver_contract ||
      paymentConfig?.receiver_contract ||
      "",
  ).toLowerCase();
  const paymentWalletLabel = String(
    selectedWallet ||
      walletAddress ||
      boundWallets.find((row) => row.is_primary)?.address ||
      boundWallets[0]?.address ||
      "",
  ).toLowerCase();
  const hasPayingWallet = Boolean(
    String(
      selectedWallet || walletAddress || boundWallets[0]?.address || "",
    ).trim(),
  );

  const billing = useMemo(() => {
    const parsedPlanAmount = Number(
      backend?.telegram_pricing?.amount_usdc ?? selectedPlan?.amount_usdc ?? 5,
    );
    const planAmount =
      Number.isFinite(parsedPlanAmount) && parsedPlanAmount > 0
        ? parsedPlanAmount
        : 5;

    const pointsCfg = paymentConfig?.points_redemption || {};
    const pointsEnabled = pointsCfg.enabled !== false;
    const pointsPerUsdcRaw = Number(pointsCfg.points_per_usdc ?? 500);
    const pointsPerUsdc =
      Number.isFinite(pointsPerUsdcRaw) && pointsPerUsdcRaw > 0
        ? Math.floor(pointsPerUsdcRaw)
        : 500;

    const maxDiscountRaw = Number(pointsCfg.max_discount_usdc ?? 3);
    const maxDiscountUsdc = Math.max(
      0,
      Math.min(
        Math.floor(Number.isFinite(maxDiscountRaw) ? maxDiscountRaw : 3),
        Math.floor(planAmount),
      ),
    );

    const maxRedeemablePoints = pointsPerUsdc * maxDiscountUsdc;
    const actualRedeem = pointsEnabled
      ? Math.min(totalPoints, maxRedeemablePoints)
      : 0;
    const discountUnits = Math.floor(actualRedeem / pointsPerUsdc);
    const pointsUsed = discountUnits * pointsPerUsdc;
    const canRedeem =
      pointsEnabled && maxDiscountUsdc > 0 && totalPoints >= pointsPerUsdc;
    const applyDiscount = usePoints && canRedeem && pointsUsed > 0;

    return {
      planAmount,
      pointsEnabled,
      pointsPerUsdc,
      maxDiscountUsdc,
      pointsUsed,
      discountAmount: discountUnits,
      payAmount: planAmount - (applyDiscount ? discountUnits : 0),
      canRedeem,
    };
  }, [
    paymentConfig?.points_redemption,
    backend?.telegram_pricing?.amount_usdc,
    selectedPlan?.amount_usdc,
    totalPoints,
    usePoints,
  ]);

  const bindCommand = userId
    ? `/bind ${userId}${email ? ` ${email}` : ""}`
    : "/bind <supabase_user_id> <email>";

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const openTelegramBotBindLink = async () => {
    setTelegramBindOpening(true);
    setPaymentError("");
    try {
      const authHeaders = await buildAuthedHeaders(true, false);
      const res = await fetch("/api/auth/telegram/bot-bind-link", {
        method: "POST",
        headers: authHeaders,
      });
      if (!res.ok) {
        const raw = (await res.text()).slice(0, 300);
        throw new Error(raw || "failed to create telegram bind link");
      }
      const data = (await res.json()) as { bot_url?: string };
      const botUrl = String(data.bot_url || "").trim();
      if (!botUrl) throw new Error("telegram bind link missing");
      window.open(botUrl, "_blank", "noopener,noreferrer");
      setPaymentInfo(
        "已打开 Telegram Bot，请在 Bot 内点击 Start 并确认绑定；完成后刷新本页再申请入群。",
      );
    } catch (error) {
      setPaymentError(normalizePaymentError(error).message);
    } finally {
      setTelegramBindOpening(false);
    }
  };

  // --- Payment Logic (preserved) ---

  const waitForReceipt = async (
    txHash: string,
    timeoutMs = 120000,
    pollMs = 3000,
  ) => {
    const eth = getEvmProvider();
    if (!eth) throw new Error("No EVM wallet provider found");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = (await eth.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      })) as { status?: string } | null;
      if (receipt && receipt.status) {
        if (receipt.status === "0x1") return receipt;
        throw new Error(`transaction reverted: ${txHash}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error(`transaction confirmation timeout: ${txHash}`);
  };

  const pollIntentUntilConfirmed = useCallback(
    async (
      intentId: string,
      authHeaders: Record<string, string>,
      txHashHint = "",
      timeoutMs = 180000,
      pollMs = 5000,
    ) => {
      const startedAt = Date.now();
      const shortTx = shortAddress(txHashHint);
      while (Date.now() - startedAt < timeoutMs) {
        const statusRes = await fetch(`/api/payments/intents/${intentId}`, {
          method: "GET",
          headers: authHeaders,
          cache: "no-store",
        });
        if (!statusRes.ok) {
          if (statusRes.status >= 500 || statusRes.status === 429) {
            await new Promise((resolve) => setTimeout(resolve, pollMs));
            continue;
          }
          const raw = (await statusRes.text()).slice(0, 260);
          throw new Error(`query intent failed: ${raw}`);
        }

        const statusJson = (await statusRes.json()) as IntentStatusResponse;
        const intent = statusJson.intent || {};
        const status = String(intent.status || "").toLowerCase();
        const txHash = String(intent.tx_hash || txHashHint || "").toLowerCase();
        if (status === "confirmed") {
          setPaymentError("");
          setPaymentInfo(`支付确认成功，交易: ${shortAddress(txHash)}`);
          trackAppEvent("checkout_succeeded", {
            entry: "account_center",
            plan_code: selectedPlan?.plan_code || "pro_monthly",
            intent_id: intentId,
            tx_hash: txHash || null,
          });
          await loadSnapshot();
          await loadPaymentSnapshot();
          return;
        }
        if (
          status === "failed" ||
          status === "cancelled" ||
          status === "expired"
        ) {
          throw new Error(`payment ${status}`);
        }
        setPaymentInfo(
          `交易已提交: ${shortTx}，正在链上确认（状态: ${status || "submitted"}）...`,
        );
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      throw new Error("payment pending timeout");
    },
    [loadPaymentSnapshot, loadSnapshot, selectedPlan?.plan_code],
  );

  const signBindMessage = async (
    eth: EvmProvider,
    address: string,
    message: string,
  ): Promise<string> => {
    try {
      return (await eth.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;
    } catch {
      // Some injected wallets still use the reversed param order.
      return (await eth.request({
        method: "personal_sign",
        params: [address, message],
      })) as string;
    }
  };

  const ensureTargetChain = async (
    eth: EvmProvider,
    targetChainId: number,
  ): Promise<void> => {
    const currentChainIdHex = String(
      (await eth.request({ method: "eth_chainId" })) || "",
    );
    const targetChainHex = `0x${targetChainId.toString(16)}`;
    if (currentChainIdHex.toLowerCase() === targetChainHex.toLowerCase())
      return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainHex }],
      });
    } catch (err: any) {
      const code = Number(err?.code);
      if (code !== 4902 || targetChainId !== 137) throw err;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x89",
            chainName: "Polygon Mainnet",
            nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
            rpcUrls: ["https://polygon-rpc.com"],
            blockExplorerUrls: ["https://polygonscan.com"],
          },
        ],
      });
    }
  };

  const connectAndBindWallet = async (
    mode: ProviderMode = "auto",
    options: ConnectBindOptions = {},
  ): Promise<boolean> => {
    setPaymentError("");
    setPaymentInfo("");
    if (!isAuthenticated) {
      setPaymentError(copy.loginBeforeBind);
      return false;
    }

    setPaymentBusy(true);
    try {
      const providerSelection = await resolvePaymentProvider(
        mode,
        selectedInjectedProviderKey,
      );
      const eth = providerSelection.provider;
      const walletLabel = providerSelection.label;

      // Ensure we have a valid token BEFORE opening the wallet modal.
      let accessToken: string;
      try {
        accessToken = await getValidAccessToken();
      } catch (tokenErr) {
        setPaymentError(normalizePaymentError(tokenErr).message);
        setPaymentBusy(false);
        return false;
      }
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      };

      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const address = String(accounts?.[0] || "").toLowerCase();
      if (!address)
        throw new Error(isEn ? "Wallet account is empty." : "钱包账户为空");

      const existingWallet = boundWallets.find(
        (w) => String(w.address || "").toLowerCase() === address,
      );
      if (existingWallet) {
        setWalletAddress(address);
        setSelectedWallet(address);
        setPaymentInfo(
          `${walletLabel} 已绑定: ${shortAddress(address)}。现在可点击“立即订阅并激活服务”。`,
        );
        await Promise.all([loadSnapshot(), loadPaymentSnapshot()]);
        if (options.openOverlayAfterBind) setShowOverlay(true);
        setPaymentBusy(false);
        return true;
      }

      setWalletAddress(address);
      const challengeRes = await fetch("/api/payments/wallets/challenge", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ address }),
      });
      if (!challengeRes.ok) {
        const raw = (await challengeRes.text()).slice(0, 300);
        throw new Error(`challenge failed: ${raw}`);
      }

      const challengeJson = (await challengeRes.json()) as {
        nonce?: string;
        message?: string;
      };
      const message = String(challengeJson.message || "");
      const nonce = String(challengeJson.nonce || "");
      if (!message || !nonce) throw new Error("challenge payload invalid");

      const signature = await signBindMessage(eth, address, message);
      const verifyRes = await fetch("/api/payments/wallets/verify", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ address, nonce, signature }),
      });
      if (!verifyRes.ok) {
        const raw = (await verifyRes.text()).slice(0, 300);
        throw new Error(`verify failed: ${raw}`);
      }

      setPaymentInfo(
        `${walletLabel} 绑定成功: ${shortAddress(address)}。现在可点击“立即订阅并激活服务”。`,
      );
      setProviderMode(providerSelection.mode);
      if (options.openOverlayAfterBind) setShowOverlay(true);
      await Promise.all([loadSnapshot(), loadPaymentSnapshot()]);
      return true;
    } catch (error) {
      setPaymentInfo("");
      setPaymentError(normalizePaymentError(error).message);
      return false;
    } finally {
      setPaymentBusy(false);
    }
  };

  const handleUnbindWallet = async (address: string) => {
    const target = String(address || "").toLowerCase();
    if (!target) return;
    if (!isAuthenticated) {
      setPaymentError(copy.loginBeforeBind);
      return;
    }
    const confirmed = window.confirm(
      copy.unbindConfirm.replace("{address}", shortAddress(target)),
    );
    if (!confirmed) return;

    setPaymentBusy(true);
    setPaymentError("");
    setPaymentInfo("");
    try {
      // Do not hard-fail on client-side token refresh here.
      // The same-origin API route can still authenticate via server-side Supabase session cookies.
      const headers = await buildAuthedHeaders(true, false);
      const res = await fetch("/api/payments/wallets", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ address: target }),
      });
      const raw = await res.text();
      if (!res.ok) {
        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          detail = String(parsed?.detail || parsed?.error || raw);
          if (detail.trim().startsWith("{")) {
            try {
              const nested = JSON.parse(detail);
              detail = String(nested?.detail || nested?.error || detail);
            } catch {
              // ignore nested parse failure
            }
          }
        } catch {
          // ignore
        }
        throw new Error(detail || `HTTP ${res.status}`);
      }

      let data: Record<string, unknown> = {};
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }
      const newPrimary = String(data?.new_primary || "").toLowerCase();
      const selectedWalletNorm = String(selectedWallet || "").toLowerCase();
      const walletAddressNorm = String(walletAddress || "").toLowerCase();
      if (selectedWalletNorm === target) {
        setSelectedWallet(newPrimary || "");
      }
      if (walletAddressNorm === target) {
        setWalletAddress(newPrimary || "");
      }
      setBoundWallets((prev) =>
        prev.filter(
          (row) => String(row.address || "").toLowerCase() !== String(target),
        ),
      );
      await loadPaymentSnapshot();
      setPaymentInfo(
        newPrimary
          ? copy.unbindDonePrimary.replace(
              "{address}",
              shortAddress(newPrimary),
            )
          : copy.unbindDone,
      );
    } catch (error) {
      const message = normalizePaymentError(error).message;
      const lower = String(message || "").toLowerCase();
      if (
        lower.includes("unauthorized") ||
        lower.includes("session required") ||
        lower.includes("401")
      ) {
        setPaymentError(`${copy.unbindFailed}: ${copy.authExpired}`);
        return;
      }
      setPaymentError(`${copy.unbindFailed}: ${message}`);
    } finally {
      setPaymentBusy(false);
    }
  };

  const createIntentAndPay = async () => {
    setPaymentError("");
    setPaymentInfo("");
    setLastIntentId("");
    setLastTxHash("");
    setLastPaymentStartedAt(0);
    clearStoredPaymentRecovery();
    if (!paymentHostAllowed) {
      setPaymentError(
        copy.paymentHostBlocked.replace(
          "{host}",
          allowedPaymentHosts[0] || "polyweather-pro.vercel.app",
        ),
      );
      return;
    }
    if (!isAuthenticated) {
      setPaymentError(copy.loginBeforePay);
      return;
    }
    if (!paymentConfig?.configured) {
      setPaymentError(copy.payNotReady);
      return;
    }

    const fallbackWallet = String(
      selectedWallet || walletAddress || boundWallets[0]?.address || "",
    ).toLowerCase();
    if (!fallbackWallet) {
      setPaymentError(copy.bindFirstBeforePay);
      return;
    }

    setPaymentBusy(true);
    let approvedInThisRun = false;
    try {
      const providerSelection = await resolvePaymentProvider(
        providerMode,
        selectedInjectedProviderKey,
      );
      const eth = providerSelection.provider;
      const activeAccounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const activeAddress = String(activeAccounts?.[0] || "").toLowerCase();
      if (!activeAddress)
        throw new Error(isEn ? "Wallet account is empty." : "钱包账户为空");

      const boundAddrSet = new Set(
        boundWallets.map((row) => String(row.address || "").toLowerCase()),
      );
      if (boundAddrSet.size > 0 && !boundAddrSet.has(activeAddress)) {
        throw new Error(
          `当前连接钱包 ${shortAddress(activeAddress)} 未绑定，请先绑定该地址后支付。`,
        );
      }
      const payingWallet = boundAddrSet.has(activeAddress)
        ? activeAddress
        : fallbackWallet;

      setSelectedWallet(payingWallet);
      setProviderMode(providerSelection.mode);

      // Ensure we have a valid token BEFORE switching chain / sending tx.
      let accessToken: string;
      try {
        accessToken = await getValidAccessToken();
      } catch (tokenErr) {
        setPaymentError(normalizePaymentError(tokenErr).message);
        setPaymentBusy(false);
        return;
      }
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      };

      const latestConfig = await fetchLatestPaymentConfig(authHeaders, true);
      if (!latestConfig?.enabled || !latestConfig?.configured) {
        throw new Error(copy.payNotReady);
      }
      const expectedReceiver = String(
        latestConfig.receiver_contract || "",
      ).toLowerCase();
      if (!expectedReceiver.startsWith("0x")) {
        throw new Error("payment receiver contract is not configured");
      }
      if (
        paymentConfig?.receiver_contract &&
        String(paymentConfig.receiver_contract).toLowerCase() !==
          expectedReceiver
      ) {
        setPaymentInfo(
          `检测到支付配置已更新，已切换到最新地址 ${shortAddress(expectedReceiver)}。`,
        );
      } else {
        setPaymentInfo(`当前收款合约: ${shortAddress(expectedReceiver)}`);
      }

      const targetChainId = Number(latestConfig.chain_id || 137);
      await ensureTargetChain(eth, targetChainId);

      const createRes = await fetch("/api/payments/intents", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          plan_code: selectedPlan?.plan_code || "pro_monthly",
          payment_mode: "strict",
          allowed_wallet: payingWallet,
          token_address: resolvedSelectedTokenAddress || undefined,
          use_points: billing.canRedeem && usePoints,
          points_to_consume:
            billing.canRedeem && usePoints ? billing.pointsUsed : 0,
          metadata: {
            source: "account_center",
            frontend_host: currentPaymentHost || null,
            account_email: email || null,
          },
        }),
      });
      if (!createRes.ok) {
        const raw = (await createRes.text()).slice(0, 350);
        throw new Error(`create intent failed: ${raw}`);
      }

      const created = (await createRes.json()) as CreatedIntent;
      const intentId = String(created.intent?.intent_id || "");
      const txPayload = created.tx_payload;
      if (!intentId || !txPayload?.to || !txPayload?.data)
        throw new Error("intent payload invalid");
      trackAppEvent("checkout_started", {
        entry: "account_center",
        plan_code: selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        use_points: billing.canRedeem && usePoints,
        pay_amount_usd: billing.payAmount,
      });
      const intentReceiver = String(txPayload.to || "").toLowerCase();
      if (intentReceiver !== expectedReceiver) {
        throw new Error(
          `payment receiver changed: expected ${expectedReceiver}, got ${intentReceiver}. 请刷新页面后重试。`,
        );
      }
      setLastIntentId(intentId);

      const tokenAddress = String(txPayload.token_address || "").toLowerCase();
      const amountUnits = BigInt(String(txPayload.amount_units || "0"));
      if (!tokenAddress.startsWith("0x") || amountUnits <= 0n)
        throw new Error("intent token/amount invalid");
      const tokenSymbol = String(
        txPayload.token_symbol ||
          selectedPaymentToken?.symbol ||
          selectedTokenLabel ||
          "USDC",
      );
      const tokenDecimals = Number(
        txPayload.token_decimals ??
          selectedPaymentToken?.decimals ??
          latestConfig?.token_decimals ??
          6,
      );

      const balanceHex = (await eth.request({
        method: "eth_call",
        params: [
          {
            to: tokenAddress,
            data: buildBalanceOfCalldata(payingWallet),
          },
          "latest",
        ],
      })) as string;
      const tokenBalance = BigInt(String(balanceHex || "0x0"));
      if (tokenBalance < amountUnits) {
        const need = formatTokenUnits(amountUnits, tokenDecimals);
        const have = formatTokenUnits(tokenBalance, tokenDecimals);
        throw new Error(
          `支付代币余额不足：需要 ${need} ${tokenSymbol}，当前 ${have} ${tokenSymbol}。请确认你钱包里持有该支付币种。`,
        );
      }

      const allowanceHex = (await eth.request({
        method: "eth_call",
        params: [
          {
            to: tokenAddress,
            data: buildAllowanceCalldata(payingWallet, txPayload.to),
          },
          "latest",
        ],
      })) as string;
      const allowance = BigInt(String(allowanceHex || "0x0"));

      if (allowance < amountUnits) {
        setPaymentInfo(`检测到授权不足，正在发起 ${tokenSymbol} 授权...`);
        const approveHash = (await eth.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: payingWallet,
              to: tokenAddress,
              data: buildApproveCalldata(txPayload.to, amountUnits),
              value: "0x0",
            },
          ],
        })) as string;
        await waitForReceipt(String(approveHash || ""));
        approvedInThisRun = true;
        setPaymentInfo(`${tokenSymbol} 授权成功，正在发起支付...`);
      } else {
        setPaymentInfo("授权额度充足，正在发起支付...");
      }

      const txHash = (await eth.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: payingWallet,
            to: txPayload.to,
            data: txPayload.data,
            value: txPayload.value || "0x0",
          },
        ],
      })) as string;
      const txHashNorm = String(txHash || "").toLowerCase();
      setLastTxHash(txHashNorm);
      setLastPaymentStartedAt(Date.now());

      const submitRes = await fetch(
        `/api/payments/intents/${intentId}/submit`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            tx_hash: txHashNorm,
            from_address: payingWallet,
          }),
        },
      );
      if (!submitRes.ok) {
        const raw = (await submitRes.text()).slice(0, 350);
        throw new Error(`submit tx failed: ${raw}`);
      }

      const confirmRes = await fetch(
        `/api/payments/intents/${intentId}/confirm`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ tx_hash: txHashNorm }),
        },
      );
      if (!confirmRes.ok) {
        const raw = (await confirmRes.text()).slice(0, 350);
        const lowerRaw = raw.toLowerCase();
        const maybePending =
          (confirmRes.status === 404 &&
            !lowerRaw.includes("payment intent not found")) ||
          confirmRes.status === 408 ||
          (confirmRes.status === 409 &&
            (lowerRaw.includes("confirmations not enough") ||
              lowerRaw.includes("tx indexed partially")));
        if (maybePending) {
          setPaymentInfo(
            `交易已提交: ${shortAddress(txHashNorm)}，等待链上确认中...`,
          );
          await pollIntentUntilConfirmed(intentId, authHeaders, txHashNorm);
          return;
        }
        throw new Error(`confirm failed: ${raw}`);
      }

      setPaymentInfo(`支付确认成功，交易: ${shortAddress(txHashNorm)}`);
      trackAppEvent("checkout_succeeded", {
        entry: "account_center",
        plan_code: selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        tx_hash: txHashNorm,
      });
      await loadSnapshot();
      await loadPaymentSnapshot();
    } catch (error) {
      const normalized = normalizePaymentError(error);
      if (normalized.pending) {
        setPaymentError(normalized.message);
      } else if (normalized.userRejected) {
        setPaymentInfo(
          approvedInThisRun
            ? `${selectedTokenLabel} 授权已完成，本次支付已取消，可直接再次点击支付。`
            : "",
        );
        setPaymentError(normalized.message);
      } else {
        setPaymentInfo(
          approvedInThisRun
            ? `${selectedTokenLabel} 授权已完成，但支付未完成，请重试。`
            : "",
        );
        setPaymentError(normalized.message);
      }
    } finally {
      setPaymentBusy(false);
    }
  };

  const createManualPaymentIntent = async () => {
    setPaymentError("");
    setPaymentInfo("");
    setManualPayment(null);
    setManualTxHash("");
    setLastIntentId("");
    setLastTxHash("");
    if (!paymentHostAllowed) {
      setPaymentError(
        copy.paymentHostBlocked.replace(
          "{host}",
          allowedPaymentHosts[0] || "polyweather-pro.vercel.app",
        ),
      );
      return;
    }
    if (!isAuthenticated) {
      setPaymentError(copy.loginBeforePay);
      return;
    }
    if (!paymentConfig?.configured) {
      setPaymentError(copy.payNotReady);
      return;
    }

    setPaymentBusy(true);
    try {
      const authHeaders = await buildAuthedHeaders(true, false);
      const createRes = await fetch("/api/payments/intents", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          plan_code: selectedPlan?.plan_code || "pro_monthly",
          payment_mode: "direct",
          token_address: resolvedSelectedTokenAddress || undefined,
          use_points: billing.canRedeem && usePoints,
          points_to_consume:
            billing.canRedeem && usePoints ? billing.pointsUsed : 0,
          metadata: {
            source: "account_center_manual_transfer",
            frontend_host: currentPaymentHost || null,
            account_email: email || null,
          },
        }),
      });
      if (!createRes.ok) {
        const raw = (await createRes.text()).slice(0, 350);
        throw new Error(`create manual intent failed: ${raw}`);
      }
      const created = (await createRes.json()) as CreatedIntent;
      const direct = created.direct_payment;
      const intentId = String(
        created.intent?.intent_id || direct?.intent_id || "",
      );
      if (!intentId || !direct?.receiver_address || !direct?.amount_usdc) {
        throw new Error("manual payment payload invalid");
      }
      setLastIntentId(intentId);
      setManualPayment(direct);
      setShowOverlay(false);
      setPaymentInfo(
        `手动转账订单已创建：请在 Polygon 网络转 ${direct.amount_usdc} ${direct.token_symbol || selectedTokenLabel} 到 ${shortAddress(direct.receiver_address)}，完成后提交 tx hash。`,
      );
      trackAppEvent("checkout_started", {
        entry: "account_center_manual_transfer",
        plan_code: selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        payment_mode: "direct",
        use_points: billing.canRedeem && usePoints,
        pay_amount_usd: billing.payAmount,
      });
    } catch (error) {
      setPaymentError(normalizePaymentError(error).message);
    } finally {
      setPaymentBusy(false);
    }
  };

  const submitManualPaymentTx = async () => {
    const txHashNorm = String(manualTxHash || "")
      .trim()
      .toLowerCase();
    const intentId = String(
      lastIntentId || manualPayment?.intent_id || "",
    ).trim();
    if (!intentId || !manualPayment) {
      setPaymentError("请先创建手动转账订单。");
      return;
    }
    if (!txHashNorm.startsWith("0x") || txHashNorm.length !== 66) {
      setPaymentError("请输入有效的 tx hash。");
      return;
    }
    setPaymentBusy(true);
    setPaymentError("");
    try {
      const authHeaders = await buildAuthedHeaders(true, false);
      const submitRes = await fetch(
        `/api/payments/intents/${intentId}/submit`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ tx_hash: txHashNorm }),
        },
      );
      if (!submitRes.ok) {
        const raw = (await submitRes.text()).slice(0, 350);
        throw new Error(`submit tx failed: ${raw}`);
      }
      const confirmRes = await fetch(
        `/api/payments/intents/${intentId}/confirm`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ tx_hash: txHashNorm }),
        },
      );
      if (!confirmRes.ok) {
        const raw = (await confirmRes.text()).slice(0, 350);
        const lowerRaw = raw.toLowerCase();
        const maybePending =
          confirmRes.status === 408 ||
          (confirmRes.status === 409 &&
            (lowerRaw.includes("confirmations not enough") ||
              lowerRaw.includes("tx indexed partially")));
        if (maybePending) {
          setPaymentInfo(
            `交易已提交: ${shortAddress(txHashNorm)}，等待链上确认中...`,
          );
          await pollIntentUntilConfirmed(intentId, authHeaders, txHashNorm);
          return;
        }
        throw new Error(`confirm failed: ${raw}`);
      }
      setLastTxHash(txHashNorm);
      setPaymentInfo(`支付确认成功，交易: ${shortAddress(txHashNorm)}`);
      setManualPayment(null);
      setManualTxHash("");
      trackAppEvent("checkout_succeeded", {
        entry: "account_center_manual_transfer",
        plan_code: selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        tx_hash: txHashNorm,
      });
      await loadSnapshot();
      await loadPaymentSnapshot();
    } catch (error) {
      setPaymentError(normalizePaymentError(error).message);
    } finally {
      setPaymentBusy(false);
    }
  };

  const handleOverlayCheckout = async () => {
    if (!paymentHostAllowed) {
      setPaymentError(
        copy.paymentHostBlocked.replace(
          "{host}",
          allowedPaymentHosts[0] || "polyweather-pro.vercel.app",
        ),
      );
      return;
    }
    if (!isAuthenticated) {
      setPaymentError(copy.loginBeforePay);
      return;
    }
    if (!hasPayingWallet) {
      setPaymentInfo(copy.openBindFlow);
      const bound = await connectAndBindWallet(providerMode, {
        openOverlayAfterBind: true,
      });
      if (!bound) return;
      setPaymentInfo(copy.walletBoundCreatingOrder);
      await createIntentAndPay();
      return;
    }
    await createIntentAndPay();
  };

  // --- Render ---

  if (loading && !refreshing) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0b0f1a]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
          <p className="text-slate-400 font-medium">{copy.loadingAccount}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#0b0f1a] text-slate-200 p-4 md:p-8 font-sans relative overflow-hidden flex flex-col items-center">
      {/* Aurora Shadows */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none"></div>

      {/* Header */}
      <header className="w-full max-w-6xl flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 z-20">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-slate-400 hover:text-white transition-all active:scale-90 group"
            title={copy.backHome}
            aria-label={copy.backHome}
          >
            <ChevronLeft
              size={20}
              className="group-hover:-translate-x-0.5 transition-transform"
            />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              {copy.accountCenter}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!showOverlay && canOpenCheckoutOverlay && (
            <button
              onClick={() => setShowOverlay(true)}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 rounded-xl text-sm transition-all animate-pulse"
            >
              <Crown size={16} />{" "}
              {showExpiringSoon || showExpiredReminder
                ? copy.renewNow
                : copy.upgradePro}
            </button>
          )}
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm transition-all disabled:opacity-50"
            disabled={refreshing}
          >
            {refreshing ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}{" "}
            {copy.refresh}
          </button>
          {isAuthenticated ? (
            <button
              onClick={() => void onSignOut()}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl text-sm transition-all"
            >
              <LogOut size={16} /> {copy.signOut}
            </button>
          ) : (
            <Link
              href="/auth/login?next=%2Faccount"
              className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-xl text-sm transition-all"
            >
              <LogIn size={16} /> {copy.signIn}
            </Link>
          )}
        </div>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 z-10 relative">
        {(showExpiringSoon || showExpiredReminder) && (
          <div className="lg:col-span-12 rounded-[2rem] border border-amber-400/30 bg-amber-500/10 px-6 py-5 shadow-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
                  <Crown size={16} />
                  <span>{subscriptionStatusTitle}</span>
                </div>
                <p className="mt-1 text-sm text-amber-50/90">
                  {subscriptionStatusBody}
                </p>
                {subscriptionStatusMeta ? (
                  <p className="mt-1 text-xs text-amber-200/80">
                    {subscriptionStatusMeta}
                  </p>
                ) : null}
                {billing.canRedeem ? (
                  <p className="mt-2 text-xs text-emerald-200/90">
                    当前可用 {billing.pointsUsed} 积分抵扣 $
                    {billing.discountAmount.toFixed(2)}， 续费时会自动生效。
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setShowOverlay(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/35 bg-amber-300/12 px-4 py-2 text-sm font-bold text-amber-100 transition-all hover:bg-amber-300/20"
              >
                <Crown size={16} />
                {showExpiredReminder ? copy.renewNow : copy.upgradePro}
              </button>
            </div>
          </div>
        )}

        {/* User Card */}
        <div className="lg:col-span-8 bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl flex flex-col md:flex-row items-center gap-8">
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-400 flex items-center justify-center text-3xl font-bold text-white shadow-xl shadow-blue-500/30">
              {initials}
            </div>
            <div
              className={`absolute -bottom-2 -right-2 p-1.5 rounded-xl border-4 border-[#0b0f1a] ${isSubscribed ? "bg-yellow-500 text-black" : "bg-slate-700 text-slate-400"}`}
            >
              <Crown size={16} fill="currentColor" />
            </div>
          </div>
          <div className="flex-grow text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-3 mb-1">
              <h2 className="text-3xl font-bold text-white">{displayName}</h2>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter border ${isSubscribed ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "bg-slate-700/50 border-white/10 text-slate-500"}`}
              >
                {isSubscribed
                  ? isTrialPlan
                    ? copy.trialBadge
                    : copy.proMember
                  : copy.freeTier}
              </span>
            </div>
            <p className="text-slate-500 font-mono text-sm mb-4">
              {email || copy.guestUser}
            </p>
            <div className="flex flex-wrap justify-center md:justify-start gap-4">
              <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                <Hash size={14} />{" "}
                <span className="font-mono">
                  {userId ? `${userId.substring(0, 12)}...` : "--"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                <Clock size={14} />{" "}
                <span>
                  {copy.joinedAt}: {joinedAt}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="px-6 py-4 bg-black/40 rounded-2xl border border-white/5 text-center min-w-[140px]">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">
                {copy.totalPoints}
              </p>
              <p className="text-xl font-bold text-white flex items-center justify-center gap-2">
                <Coins size={16} className="text-yellow-500" />{" "}
                {totalPoints.toLocaleString()}
              </p>
            </div>
            <div className="px-6 py-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 text-center min-w-[140px]">
              <p className="text-[10px] text-emerald-300 uppercase tracking-widest mb-1 font-bold">
                {copy.weeklyPoints}
              </p>
              <p className="text-xl font-bold text-white flex items-center justify-center gap-2">
                <TrendingUp size={16} className="text-emerald-400" />{" "}
                {weeklyPoints.toLocaleString()}
              </p>
            </div>
            <div className="px-6 py-4 bg-blue-500/10 rounded-2xl border border-blue-500/20 text-center min-w-[140px]">
              <p className="text-[10px] text-blue-400 uppercase tracking-widest mb-1 font-bold">
                {copy.weeklyRank}
              </p>
              <p className="text-xl font-bold text-white flex items-center justify-center gap-2">
                <Trophy size={16} className="text-amber-400" />{" "}
                {weeklyRank === "--" ? weeklyRank : `#${weeklyRank}`}
              </p>
            </div>
          </div>
        </div>

        {/* Weekly Ranking Motivation */}
        {showSecondarySections ? (
          <div className="lg:col-span-4 bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border border-indigo-500/30 rounded-[2.5rem] p-6 flex flex-col justify-between shadow-xl">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2 text-white mb-6">
                <Sparkles size={20} className="text-yellow-400" />{" "}
                {copy.weeklyRewards}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <span className="text-sm flex items-center gap-2">
                    <div className="w-5 h-5 bg-yellow-500 rounded text-black font-bold text-[10px] flex items-center justify-center">
                      1
                    </div>{" "}
                    Top 1
                  </span>
                  <span className="text-xs font-bold text-yellow-500">
                    +200 积分 & 7天Pro
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <span className="text-sm flex items-center gap-2">
                    <div className="w-5 h-5 bg-slate-300 rounded text-black font-bold text-[10px] flex items-center justify-center">
                      2
                    </div>{" "}
                    Top 2-3
                  </span>
                  <span className="text-xs font-bold text-slate-300">
                    +100 积分 & 3天Pro
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <span className="text-sm flex items-center gap-2">
                    <div className="w-5 h-5 bg-orange-800 rounded text-white font-bold text-[10px] flex items-center justify-center">
                      4
                    </div>{" "}
                    Top 4-10
                  </span>
                  <span className="text-xs font-bold text-orange-400">
                    +50 积分
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex items-start gap-2 p-3 bg-black/20 rounded-xl">
              <Info size={14} className="text-slate-500 mt-0.5 shrink-0" />
              <p className="text-[10px] text-slate-500 leading-normal italic">
                积分规则：群内有效发言（自动防刷检测）+
                每日首条发言额外奖励。每周一零点结算周榜，所有活跃用户均享参与奖。
              </p>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-4 rounded-[2.5rem] border border-white/10 bg-white/5 p-6">
            <div className="h-6 w-40 animate-pulse rounded bg-slate-800/80" />
            <div className="mt-4 space-y-2">
              <div className="h-12 animate-pulse rounded-xl bg-slate-800/60" />
              <div className="h-12 animate-pulse rounded-xl bg-slate-800/60" />
              <div className="h-12 animate-pulse rounded-xl bg-slate-800/60" />
            </div>
          </div>
        )}

        {/* Subscription Info & Paywall */}
        <div className="lg:col-span-12 relative">
          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-all duration-700 ${canOpenCheckoutOverlay && showOverlay ? "blur-md grayscale-[0.3] opacity-30 select-none pointer-events-none" : ""}`}
          >
            <section className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-3">
              <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest mb-4">
                {copy.membershipDetails}
              </h3>
              <InfoRow
                icon={ShieldCheck}
                label={copy.authMode}
                value="Supabase"
              />
              <InfoRow
                icon={BarChart3}
                label={copy.weatherEngine}
                value="DEB + 多模型"
              />
              <InfoRow
                icon={Zap}
                label={copy.intradayAnalysis}
                value={isSubscribed ? copy.deepMode : copy.compactVisible}
                isPrimary={isSubscribed}
              />
              <InfoRow
                icon={Clock}
                label={copy.historyFuture}
                value={isSubscribed ? copy.enabled : copy.locked}
                isPrimary={isSubscribed}
              />
              <InfoRow
                icon={Bot}
                label={copy.smartPush}
                value={isSubscribed ? copy.enabled : copy.locked}
                isPrimary={isSubscribed}
              />
            </section>
            <section className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-3">
              <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-widest mb-4">
                {copy.identityStatus}
              </h3>
              <InfoRow
                icon={Mail}
                label={copy.boundEmail}
                value={email || "--"}
              />
              <InfoRow
                icon={LogIn}
                label={copy.loginMethod}
                value={user?.app_metadata?.provider?.toUpperCase() || "GOOGLE"}
              />
              <InfoRow
                icon={Clock}
                label={expiryLabel}
                value={proExpiry}
                isPrimary
              />
              <InfoRow
                icon={UserCheck}
                label={copy.authResult}
                value={backend?.authenticated ? copy.passed : copy.restricted}
              />
              {queuedExtensionSummary ? (
                <p className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-100">
                  {queuedExtensionSummary}
                </p>
              ) : null}
            </section>
          </div>

          {/* Paywall Mask */}
          {canOpenCheckoutOverlay && showOverlay && (
            <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
              <UnlockProOverlay
                points={totalPoints}
                planPriceUsd={billing.planAmount}
                usePoints={usePoints}
                onToggleUsePoints={() => setUsePoints((prev) => !prev)}
                billing={{
                  pointsEnabled: billing.pointsEnabled,
                  isEligible: billing.canRedeem,
                  pointsUsed: billing.pointsUsed,
                  discountAmount: billing.discountAmount,
                  finalPrice: billing.payAmount,
                  maxDiscountUsd: billing.maxDiscountUsdc,
                  pointsPerUsd: billing.pointsPerUsdc,
                }}
                onPay={() => void handleOverlayCheckout()}
                onManualPay={() => void createManualPaymentIntent()}
                onClose={() => setShowOverlay(false)}
                payBusy={paymentBusy}
                payLabel={hasPayingWallet ? copy.payNow : copy.connectAndPay}
                manualPayLabel="手动转账"
                errorText={paymentError || undefined}
                infoText={paymentInfo || undefined}
                txHash={lastTxHash || undefined}
                chainId={paymentConfig?.chain_id || 137}
                paymentTokenLabel={selectedTokenLabel}
                faqHref={SUBSCRIPTION_HELP_HREF}
                telegramGroupUrl=""
              />
            </div>
          )}
        </div>

        {/* Telegram Bot Section — paid users only */}
        {showSecondarySections && canAccessPaidTelegramGroup ? (
          <div className="lg:col-span-12 grid grid-cols-1 md:flex gap-6">
            <section className="flex-1 bg-white/5 border border-white/10 rounded-[2rem] p-8 relative overflow-hidden group">
              <Bot
                size={140}
                className="absolute -right-8 -bottom-8 text-white/5 -rotate-12 group-hover:rotate-0 transition-transform duration-1000"
              />
              <div className="relative z-10">
                <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-blue-400">
                  <Bot size={22} /> {copy.telegramBind}
                </h3>
                <p className="text-slate-400 text-sm mb-6">
                  {copy.telegramHint}
                </p>

                <div className="mb-4 flex flex-wrap gap-2">
                  {TELEGRAM_TOPICS_GROUP_URL &&
                  TELEGRAM_TOPICS_GROUP_URL !== TELEGRAM_GROUP_URL &&
                  telegramBound ? (
                    <Link
                      href={TELEGRAM_TOPICS_GROUP_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20"
                    >
                      {copy.telegramTopicsGroupLink}
                      <ExternalLink size={12} />
                    </Link>
                  ) : null}
                  {TELEGRAM_GROUP_URL && telegramBound ? (
                    <Link
                      href={TELEGRAM_GROUP_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/20"
                    >
                      {copy.telegramGroupLink}
                      <ExternalLink size={12} />
                    </Link>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <code className="flex-grow bg-black/40 border border-white/10 p-4 rounded-xl font-mono text-xs text-blue-300 overflow-hidden text-ellipsis whitespace-nowrap">
                    {bindCommand}
                  </code>
                  <button
                    onClick={() => void openTelegramBotBindLink()}
                    disabled={telegramBindOpening || !isAuthenticated}
                    className="px-4 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg text-white text-xs font-bold"
                    title={copy.telegramBotBindLink}
                    aria-label={copy.telegramBotBindLink}
                  >
                    {telegramBindOpening ? "..." : copy.telegramBotBindLink}
                  </button>
                  <button
                    onClick={() => handleCopy(bindCommand)}
                    className="p-4 bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg text-white"
                    title={copy.copyCommand}
                    aria-label={copy.copyCommand}
                  >
                    {copied ? <CheckCircle2 size={20} /> : <Copy size={20} />}
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-400">
                  {copy.telegramFallbackHint}
                </p>
                <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-500/8 px-4 py-3 text-xs leading-6 text-amber-100/90">
                  {copy.paymentManualSupport}
                </div>
              </div>
            </section>

            {/* Payment Details / Wallet Management */}
            <section className="w-full md:w-96 bg-white/5 border border-white/10 rounded-[2rem] p-8 flex flex-col justify-between">
              <div>
                <h3 className="text-blue-400 text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Wallet size={18} /> {copy.paymentMgmt}
                </h3>
                {paymentError ? (
                  <div className="mb-4 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                    {paymentError}
                  </div>
                ) : null}
                {!paymentError && paymentInfo ? (
                  <div className="mb-4 rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-200">
                    {paymentInfo}
                  </div>
                ) : null}
                {!paymentHostAllowed ? (
                  <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    {copy.paymentHostBlocked.replace(
                      "{host}",
                      allowedPaymentHosts[0] || "polyweather-pro.vercel.app",
                    )}
                  </div>
                ) : null}
                <div className="mb-5 space-y-3">
                  <InfoRow
                    icon={Mail}
                    label={copy.paymentAccount}
                    value={email || "--"}
                    isPrimary
                  />
                  <InfoRow
                    icon={Wallet}
                    label={copy.paymentWallet}
                    value={shortAddress(paymentWalletLabel) || "--"}
                  />
                  <InfoRow
                    icon={ShieldCheck}
                    label={copy.paymentReceiver}
                    value={shortAddress(paymentReceiverAddress) || "--"}
                  />
                  <InfoRow
                    icon={ExternalLink}
                    label={copy.paymentHost}
                    value={currentPaymentHost || "--"}
                  />
                  <p className="text-[11px] text-slate-500">
                    {copy.paymentGuardHint}
                  </p>
                </div>
                {availableTokenList.length > 0 && (
                  <div className="mb-5">
                    <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
                      {copy.paymentToken}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {availableTokenList.map((token) => {
                        const active =
                          token.address ===
                          (resolvedSelectedTokenAddress || token.address);
                        return (
                          <button
                            type="button"
                            key={token.address}
                            onClick={() =>
                              setSelectedTokenAddress(token.address)
                            }
                            disabled={paymentBusy}
                            className={`rounded-xl border px-3 py-2 text-left transition-all ${
                              active
                                ? "bg-blue-500/15 border-blue-500/40 text-white"
                                : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
                            }`}
                          >
                            <div className="text-xs font-bold">
                              {token.symbol}
                            </div>
                            <div className="text-[10px] opacity-80 truncate">
                              {token.name}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="mb-5 rounded-2xl border border-emerald-400/25 bg-emerald-500/8 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-emerald-200">
                        手动转账（无需绑定钱包）
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-emerald-100/75">
                        先创建订单，向唯一收款地址转账，完成后提交 tx hash
                        自动开通。请不要和钱包支付同时使用。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void createManualPaymentIntent()}
                      disabled={paymentBusy || !isAuthenticated}
                      className="shrink-0 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-[11px] font-bold text-emerald-100 transition-all hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      创建转账订单
                    </button>
                  </div>
                  {manualPayment ? (
                    <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-black/25 p-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-slate-500">
                          Amount
                        </p>
                        <p className="font-mono text-sm font-bold text-white">
                          {manualPayment.amount_usdc}{" "}
                          {manualPayment.token_symbol || selectedTokenLabel}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-slate-500">
                          Receiver
                        </p>
                        <div className="mt-1 flex gap-2">
                          <code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-2 py-2 font-mono text-[11px] text-blue-200">
                            {manualPayment.receiver_address}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(manualPayment.receiver_address)
                            }
                            className="rounded-lg bg-blue-600 px-2 text-xs font-bold text-white"
                          >
                            复制
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-slate-500">
                          Tx Hash
                        </p>
                        <input
                          value={manualTxHash}
                          onChange={(event) =>
                            setManualTxHash(event.target.value)
                          }
                          placeholder="0x..."
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-emerald-400/50"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void submitManualPaymentTx()}
                        disabled={paymentBusy}
                        className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-emerald-500 disabled:opacity-50"
                      >
                        提交 tx hash 并自动确认
                      </button>
                    </div>
                  ) : null}
                </div>
                {boundWallets.length ? (
                  <div className="space-y-3">
                    {boundWallets.map((w) => (
                      <div
                        key={w.address}
                        className={`p-3 rounded-xl border transition-all ${selectedWallet === w.address ? "bg-blue-500/10 border-blue-500/30 text-white" : "bg-white/5 border-white/5 text-slate-400"}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono">
                            {shortAddress(w.address)}
                          </span>
                          {w.is_primary && (
                            <span className="text-[8px] bg-blue-500 px-1 rounded">
                              {copy.primary}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px]">{copy.polygonChain}</div>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => void handleUnbindWallet(w.address)}
                            disabled={paymentBusy}
                            className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-300 transition-all hover:bg-red-500/20 disabled:opacity-50"
                          >
                            <Minus size={12} />
                            {copy.unbind}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">
                    {copy.noWallet}
                  </p>
                )}
              </div>

              <div className="mt-6 grid grid-cols-1 gap-2">
                {injectedProviderOptions.length > 1 && (
                  <label className="mb-2 block">
                    <span className="mb-2 block text-[11px] uppercase tracking-widest text-slate-500">
                      {copy.walletExtensionDetected}
                    </span>
                    <select
                      value={selectedInjectedProviderKey}
                      onChange={(event) =>
                        setSelectedInjectedProviderKey(event.target.value)
                      }
                      disabled={paymentBusy}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-slate-200 outline-none transition-all hover:bg-white/10 disabled:opacity-60"
                    >
                      {injectedProviderOptions.map((option) => (
                        <option
                          key={option.key}
                          value={option.key}
                          className="bg-slate-900 text-slate-200"
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  onClick={() => {
                    setProviderMode("auto");
                    void connectAndBindWallet("auto");
                  }}
                  disabled={paymentBusy || !isAuthenticated}
                  className="w-full py-3 border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-slate-300 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <PlusIcon className="w-4 h-4" /> {copy.bindExt}
                </button>
                <button
                  onClick={() => {
                    setProviderMode("walletconnect");
                    void connectAndBindWallet("walletconnect");
                  }}
                  disabled={
                    paymentBusy || !isAuthenticated || !walletConnectEnabled
                  }
                  className="w-full py-3 border border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20 rounded-xl text-xs font-bold text-cyan-300 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <CreditCard className="w-4 h-4" /> {copy.bindQr}
                </button>
                {!walletConnectEnabled && (
                  <p className="text-[11px] text-slate-500">
                    {copy.walletConnectMissing}
                    <code className="mx-1">
                      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
                    </code>
                  </p>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="lg:col-span-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="md:col-span-2 h-48 animate-pulse rounded-[2rem] border border-white/10 bg-white/5" />
            <div className="h-48 animate-pulse rounded-[2rem] border border-white/10 bg-white/5" />
          </div>
        )}
      </main>

      <footer className="mt-16 text-center text-slate-600 text-[10px] uppercase tracking-[0.3em] font-mono z-10 pb-8">
        PolyWeather Global Meteorological Engine · Powered by AI
      </footer>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  );
}
