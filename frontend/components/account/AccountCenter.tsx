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
import { UnlockProOverlay } from "@/components/subscription/UnlockProOverlay";

// --- Types ---

type AuthMeResponse = {
  authenticated?: boolean;
  user_id?: string | null;
  email?: string | null;
  points?: number;
  entitlement_mode?: string | null;
  auth_required?: boolean;
  subscription_required?: boolean;
  subscription_active?: boolean | null;
};

type PaymentPlan = {
  plan_code: string;
  plan_id: number;
  amount_usdc: string;
  duration_days: number;
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
  };
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: any[] | object;
      }) => Promise<any>;
    };
  }
}

// --- Helpers ---

type InfoRowProps = {
  icon?: LucideIcon;
  label: string;
  value: string;
  isPrimary?: boolean;
};

const InfoRow = ({ icon: Icon, label, value, isPrimary = false }: InfoRowProps) => (
  <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all group">
    <div className="flex items-center gap-3">
      <div className="p-2 bg-slate-800 rounded-lg text-slate-400 group-hover:text-blue-400 transition-colors">
        {Icon && <Icon size={18} />}
      </div>
      <span className="text-slate-400 text-sm font-medium">{label}</span>
    </div>
    <span
      className={`text-sm font-semibold font-mono ${isPrimary ? "text-blue-400" : "text-slate-200"}`}
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

function shortAddress(address: string) {
  const text = String(address || "");
  if (!text.startsWith("0x") || text.length < 12) return text || "--";
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
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

// --- Main Component ---

export function AccountCenter() {
  const router = useRouter();

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
  const [selectedWallet, setSelectedWallet] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [lastIntentId, setLastIntentId] = useState("");
  const [lastTxHash, setLastTxHash] = useState("");

  const supabaseReady = hasSupabasePublicEnv();

  const buildAuthedHeaders = useCallback(
    async (withJson = false): Promise<Record<string, string>> => {
      const headers: Record<string, string> = {};
      if (withJson) headers["Content-Type"] = "application/json";
      if (!supabaseReady) return headers;
      try {
        const {
          data: { session },
        } = await getSupabaseBrowserClient().auth.getSession();
        const accessToken = String(session?.access_token || "").trim();
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      } catch {
        // no-op
      }
      return headers;
    },
    [supabaseReady],
  );

  const loadPaymentSnapshot = useCallback(async () => {
    if (!backend?.authenticated) {
      setPaymentConfig(null);
      setBoundWallets([]);
      return;
    }
    try {
      const authHeaders = await buildAuthedHeaders(false);
      const [configRes, walletsRes] = await Promise.all([
        fetch("/api/payments/config", {
          cache: "no-store",
          headers: authHeaders,
        }),
        fetch("/api/payments/wallets", {
          cache: "no-store",
          headers: authHeaders,
        }),
      ]);
      if (configRes.ok) {
        const configJson = (await configRes.json()) as PaymentConfig;
        setPaymentConfig(configJson);
        if (!selectedPlanCode && configJson.plans?.length) {
          setSelectedPlanCode(configJson.plans[0].plan_code);
        }
      }
      if (walletsRes.ok) {
        const walletsJson = (await walletsRes.json()) as {
          wallets?: BoundWallet[];
        };
        const wallets = Array.isArray(walletsJson.wallets)
          ? walletsJson.wallets
          : [];
        setBoundWallets(wallets);
        if (wallets.length && !selectedWallet)
          setSelectedWallet(wallets[0].address);
      }
    } catch {
      // ignore
    }
  }, [
    backend?.authenticated,
    buildAuthedHeaders,
    selectedPlanCode,
    selectedWallet,
  ]);

  const loadSnapshot = useCallback(async () => {
    setErrorText("");
    try {
      const userPromise = supabaseReady
        ? getSupabaseBrowserClient().auth.getUser()
        : Promise.resolve({ data: { user: null as User | null } });
      const authHeaders = await buildAuthedHeaders(false);
      const backendPromise = fetch("/api/auth/me", {
        cache: "no-store",
        headers: authHeaders,
      });
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

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSnapshot();
    await loadPaymentSnapshot();
    setRefreshing(false);
  };

  const onSignOut = async () => {
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
  const displayName =
    String(user?.user_metadata?.full_name || "").trim() ||
    (email ? String(email).split("@")[0] : "") ||
    "PolyWeather 用户";
  const initials = (displayName.slice(0, 2) || "PW").toUpperCase();
  const joinedAt = formatTime(user?.created_at, "zh-CN");
  const isSubscribed = Boolean(backend?.subscription_active);
  const proExpiry = user?.user_metadata?.pro_expiry || "暂无 Pro 订阅";

  // Points Logic
  const backendPointsRaw = Number(backend?.points);
  const metadataPointsRaw = Number(
    user?.user_metadata?.points ?? user?.user_metadata?.total_points ?? 0,
  );
  const pointsRaw = Number.isFinite(backendPointsRaw)
    ? backendPointsRaw
    : metadataPointsRaw;
  const weeklyPointsRaw = Number(user?.user_metadata?.weekly_points ?? 0);
  const weeklyRankRaw = user?.user_metadata?.weekly_rank;
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
  const paymentFeatureReady = Boolean(
    paymentConfig?.enabled && paymentConfig?.configured,
  );
  const hasPayingWallet = Boolean(
    String(
      selectedWallet || walletAddress || boundWallets[0]?.address || "",
    ).trim(),
  );

  const billing = useMemo(() => {
    const parsedPlanAmount = Number(selectedPlan?.amount_usdc ?? 5);
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
    const canRedeem = pointsEnabled && maxDiscountUsdc > 0 && totalPoints >= pointsPerUsdc;
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

  // --- Payment Logic (preserved) ---

  const waitForReceipt = async (
    txHash: string,
    timeoutMs = 120000,
    pollMs = 3000,
  ) => {
    const eth = window.ethereum;
    if (!eth) throw new Error("MetaMask not found");
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

  const connectAndBindWallet = async () => {
    setPaymentError("");
    setPaymentInfo("");
    if (!isAuthenticated) {
      setPaymentError("请先登录后再绑定钱包。");
      return;
    }
    const eth = window.ethereum;
    if (!eth) {
      setPaymentError("未检测到 MetaMask，请先安装扩展。");
      return;
    }

    setPaymentBusy(true);
    try {
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const address = String(accounts?.[0] || "").toLowerCase();
      if (!address) throw new Error("钱包账户为空");

      const authHeaders = await buildAuthedHeaders(true);
      if (!authHeaders.Authorization)
        throw new Error("登录会话失效，请重新登录后再绑定钱包。");

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

      const signature = (await eth.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;
      const verifyRes = await fetch("/api/payments/wallets/verify", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ address, nonce, signature }),
      });
      if (!verifyRes.ok) {
        const raw = (await verifyRes.text()).slice(0, 300);
        throw new Error(`verify failed: ${raw}`);
      }

      setPaymentInfo(`钱包绑定成功: ${shortAddress(address)}`);
      await loadPaymentSnapshot();
    } catch (error) {
      setPaymentError(String(error));
    } finally {
      setPaymentBusy(false);
    }
  };

  const createIntentAndPay = async () => {
    setPaymentError("");
    setPaymentInfo("");
    if (!isAuthenticated) {
      setPaymentError("请先登录后再支付。");
      return;
    }
    if (!paymentConfig?.configured) {
      setPaymentError("支付服务未配置完成。");
      return;
    }

    const eth = window.ethereum;
    if (!eth) {
      setPaymentError("未检测到 MetaMask。");
      return;
    }

    const payingWallet = String(
      selectedWallet || walletAddress || boundWallets[0]?.address || "",
    ).toLowerCase();
    if (!payingWallet) {
      setPaymentError("请先绑定钱包。");
      return;
    }

    setPaymentBusy(true);
    try {
      const authHeaders = await buildAuthedHeaders(true);
      if (!authHeaders.Authorization)
        throw new Error("登录会话失效，请重新登录后再支付。");

      const currentChainIdHex = String(
        (await eth.request({ method: "eth_chainId" })) || "",
      );
      const targetChainId = Number(paymentConfig.chain_id || 137);
      const targetChainHex = `0x${targetChainId.toString(16)}`;
      if (currentChainIdHex.toLowerCase() !== targetChainHex.toLowerCase()) {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChainHex }],
        });
      }

      const createRes = await fetch("/api/payments/intents", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          plan_code: selectedPlan?.plan_code || "pro_monthly",
          payment_mode: "strict",
          allowed_wallet: payingWallet,
          use_points: billing.canRedeem && usePoints,
          points_to_consume: billing.canRedeem && usePoints ? billing.pointsUsed : 0,
          metadata: { source: "account_center" },
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
      setLastIntentId(intentId);

      const tokenAddress = String(txPayload.token_address || "").toLowerCase();
      const amountUnits = BigInt(String(txPayload.amount_units || "0"));
      if (!tokenAddress.startsWith("0x") || amountUnits <= 0n)
        throw new Error("intent token/amount invalid");

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
        setPaymentInfo("检测到授权不足，正在发起 USDC 授权...");
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
        setPaymentInfo("USDC 授权成功，正在发起支付...");
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
        setPaymentInfo(`交易已提交: ${shortAddress(txHashNorm)}，等待确认中。`);
        throw new Error(`confirm pending: ${raw}`);
      }

      setPaymentInfo(`支付确认成功，交易: ${shortAddress(txHashNorm)}`);
      await loadSnapshot();
      await loadPaymentSnapshot();
    } catch (error) {
      setPaymentError(String(error));
    } finally {
      setPaymentBusy(false);
    }
  };

  const handleOverlayCheckout = async () => {
    if (!isAuthenticated) {
      setPaymentError("请先登录后再支付。");
      return;
    }
    if (!hasPayingWallet) {
      await connectAndBindWallet();
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
          <p className="text-slate-400 font-medium">加载账户信息中...</p>
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
            title="返回首页"
          >
            <ChevronLeft
              size={20}
              className="group-hover:-translate-x-0.5 transition-transform"
            />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              账户中心
            </h1>
            <p className="text-slate-500 text-sm">
              积分体系 v4.3 · 管理身份与订阅计划
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isSubscribed && !showOverlay && paymentFeatureReady && (
            <button
              onClick={() => setShowOverlay(true)}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 rounded-xl text-sm transition-all animate-pulse"
            >
              <Crown size={16} /> 升级 Pro
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
            刷新
          </button>
          {isAuthenticated ? (
            <button
              onClick={() => void onSignOut()}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl text-sm transition-all"
            >
              <LogOut size={16} /> 退出
            </button>
          ) : (
            <Link
              href="/auth/login?next=%2Faccount"
              className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-xl text-sm transition-all"
            >
              <LogIn size={16} /> 登录
            </Link>
          )}
        </div>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 z-10 relative">
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
                {isSubscribed ? "PRO MEMBER" : "FREE TIER"}
              </span>
            </div>
            <p className="text-slate-500 font-mono text-sm mb-4">
              {email || "游客用户"}
            </p>
            <div className="flex flex-wrap justify-center md:justify-start gap-4">
              <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                <Hash size={14} />{" "}
                <span className="font-mono">
                  {userId ? `${userId.substring(0, 12)}...` : "--"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                <Clock size={14} /> <span>加入时间: {joinedAt}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="px-6 py-4 bg-black/40 rounded-2xl border border-white/5 text-center min-w-[140px]">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">
                总积分 (荣誉)
              </p>
              <p className="text-xl font-bold text-white flex items-center justify-center gap-2">
                <Coins size={16} className="text-yellow-500" />{" "}
                {totalPoints.toLocaleString()}
              </p>
            </div>
            <div className="px-6 py-4 bg-blue-500/10 rounded-2xl border border-blue-500/20 text-center min-w-[140px]">
              <p className="text-[10px] text-blue-400 uppercase tracking-widest mb-1 font-bold">
                周排行 (竞技)
              </p>
              <p className="text-xl font-bold text-white flex items-center justify-center gap-2">
                <Trophy size={16} className="text-amber-400" /> #{weeklyRank}
              </p>
            </div>
          </div>
        </div>

        {/* Weekly Ranking Motivation */}
        <div className="lg:col-span-4 bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border border-indigo-500/30 rounded-[2.5rem] p-6 flex flex-col justify-between shadow-xl">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 text-white mb-6">
              <Sparkles size={20} className="text-yellow-400" /> 周榜奖励
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
                  +500 pts & 7D Pro
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
                  +300 pts & 3D Pro
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
                  +150 pts
                </span>
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-start gap-2 p-3 bg-black/20 rounded-xl">
            <Info size={14} className="text-slate-500 mt-0.5 shrink-0" />
            <p className="text-[10px] text-slate-500 leading-normal italic">
              积分规则：群内有效发言（自动防刷检测）。每周一零点结算并重置周积分榜。
            </p>
          </div>
        </div>

        {/* Subscription Info & Paywall */}
        <div className="lg:col-span-12 relative">
          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-all duration-700 ${!isSubscribed && showOverlay ? "blur-md grayscale-[0.3] opacity-30 select-none pointer-events-none" : ""}`}
          >
            <section className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-3">
              <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest mb-4">
                会员权限详情
              </h3>
              <InfoRow icon={ShieldCheck} label="鉴权模式" value="Supabase" />
              <InfoRow icon={BarChart3} label="气象引擎" value="Premium AI" />
              <InfoRow
                icon={Zap}
                label="实时雷达"
                value={isSubscribed ? "已开启" : "锁定"}
                isPrimary={isSubscribed}
              />
              <InfoRow
                icon={Sparkles}
                label="平台广告"
                value={isSubscribed ? "已移除" : "可见"}
              />
            </section>
            <section className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-3">
              <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-widest mb-4">
                身份状态
              </h3>
              <InfoRow icon={Mail} label="绑定邮箱" value={email || "--"} />
              <InfoRow
                icon={LogIn}
                label="登录方式"
                value={user?.app_metadata?.provider?.toUpperCase() || "GOOGLE"}
              />
              <InfoRow
                icon={Clock}
                label="续费日期"
                value={proExpiry}
                isPrimary
              />
              <InfoRow
                icon={UserCheck}
                label="鉴权结果"
                value={backend?.authenticated ? "通过" : "受限"}
              />
            </section>
          </div>

          {/* Paywall Mask */}
          {!isSubscribed && showOverlay && (
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
                onClose={() => setShowOverlay(false)}
                payBusy={paymentBusy}
                payLabel={hasPayingWallet ? "立即订阅并激活服务" : "连接钱包并支付"}
                errorText={paymentError || undefined}
                infoText={paymentInfo || undefined}
                faqHref="/account"
              />
            </div>
          )}
        </div>

        {/* Telegram Bot Section */}
        <div className="lg:col-span-12 grid grid-cols-1 md:flex gap-6">
          <section className="flex-1 bg-white/5 border border-white/10 rounded-[2rem] p-8 relative overflow-hidden group">
            <Bot
              size={140}
              className="absolute -right-8 -bottom-8 text-white/5 -rotate-12 group-hover:rotate-0 transition-transform duration-1000"
            />
            <div className="relative z-10">
              <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-blue-400">
                <Bot size={22} /> Telegram Bot 绑定
              </h3>
              <p className="text-slate-400 text-sm mb-6">
                将下方命令发送给 Bot，实现全平台气象推送与权限同步。
              </p>
              <div className="flex gap-2">
                <code className="flex-grow bg-black/40 border border-white/10 p-4 rounded-xl font-mono text-xs text-blue-300 overflow-hidden text-ellipsis whitespace-nowrap">
                  {bindCommand}
                </code>
                <button
                  onClick={() => handleCopy(bindCommand)}
                  className="p-4 bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg text-white"
                  title="复制命令"
                >
                  {copied ? <CheckCircle2 size={20} /> : <Copy size={20} />}
                </button>
              </div>
            </div>
          </section>

          {/* Payment Details / Wallet Management */}
          <section className="w-full md:w-96 bg-white/5 border border-white/10 rounded-[2rem] p-8 flex flex-col justify-between">
            <div>
              <h3 className="text-blue-400 text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                <Wallet size={18} /> 支付管理
              </h3>
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
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="text-[10px]">Polygon Chain</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  未绑定任何收件钱包
                </p>
              )}
            </div>

            <button
              onClick={() => void connectAndBindWallet()}
              disabled={paymentBusy || !isAuthenticated}
              className="mt-6 w-full py-3 border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-slate-300 transition-all flex items-center justify-center gap-2"
            >
              <PlusIcon className="w-4 h-4" /> 绑定新钱包 (MetaMask)
            </button>
          </section>
        </div>
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
