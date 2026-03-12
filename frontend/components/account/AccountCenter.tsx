"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Coins,
  Copy,
  Crown,
  CreditCard,
  Fingerprint,
  Hash,
  Info,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trophy,
  User as UserIcon,
  UserCheck,
  Wallet,
  X,
} from "lucide-react";
import { getSupabaseBrowserClient, hasSupabasePublicEnv } from "@/lib/supabase/client";

type AuthMeResponse = {
  authenticated?: boolean;
  user_id?: string | null;
  email?: string | null;
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

type PaymentConfig = {
  enabled?: boolean;
  configured?: boolean;
  chain_id?: number;
  token_address?: string;
  token_decimals?: number;
  receiver_contract?: string;
  confirmations?: number;
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
      request: (args: { method: string; params?: any[] | object }) => Promise<any>;
    };
  }
}

type InfoItemProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  status?: "default" | "primary";
};

function formatTime(value: string | undefined | null, locale: string) {
  if (!value) return "--";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "--";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dt);
  } catch {
    return "--";
  }
}

function normalizeProvider(user: User | null) {
  const provider = String(user?.app_metadata?.provider || "").trim().toLowerCase();
  if (provider) return provider;
  const providers = user?.app_metadata?.providers;
  if (Array.isArray(providers) && providers.length) {
    return String(providers[0] || "").trim().toLowerCase();
  }
  return "";
}

function shortAddress(address: string) {
  const text = String(address || "");
  if (!text.startsWith("0x") || text.length < 12) return text || "--";
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function planDisplayName(planCode: string) {
  const code = String(planCode || "").trim().toLowerCase();
  if (code === "pro_monthly") return "Pro 月付";
  if (code === "pro_quarterly") return "Pro 季付";
  if (code === "pro_yearly") return "Pro 年付";
  return planCode || "--";
}

function toPaddedHex(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

function toPaddedAddress(address: string) {
  return String(address || "").toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function buildAllowanceCalldata(owner: string, spender: string) {
  return `0xdd62ed3e${toPaddedAddress(owner)}${toPaddedAddress(spender)}`;
}

function buildApproveCalldata(spender: string, amount: bigint) {
  return `0x095ea7b3${toPaddedAddress(spender)}${toPaddedHex(amount)}`;
}

function InfoItem({ icon: Icon, label, value, status = "default" }: InfoItemProps) {
  return (
    <div className="group flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 p-4 transition-all hover:bg-white/10">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-slate-800 p-2 text-slate-400 transition-colors group-hover:text-blue-400">
          <Icon size={18} />
        </div>
        <span className="text-sm font-medium text-slate-400">{label}</span>
      </div>
      <span className={`text-sm font-semibold ${status === "primary" ? "text-blue-400" : "text-slate-200"}`}>
        {value}
      </span>
    </div>
  );
}

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
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
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

  const buildAuthedHeaders = useCallback(async (withJson = false): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};
    if (withJson) headers["Content-Type"] = "application/json";
    if (!supabaseReady) return headers;
    try {
      const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
      const accessToken = String(session?.access_token || "").trim();
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    } catch {
      // no-op
    }
    return headers;
  }, [supabaseReady]);

  const loadPaymentSnapshot = useCallback(async () => {
    if (!backend?.authenticated) {
      setPaymentConfig(null);
      setBoundWallets([]);
      return;
    }
    try {
      const authHeaders = await buildAuthedHeaders(false);
      const [configRes, walletsRes] = await Promise.all([
        fetch("/api/payments/config", { cache: "no-store", headers: authHeaders }),
        fetch("/api/payments/wallets", { cache: "no-store", headers: authHeaders }),
      ]);
      if (configRes.ok) {
        const configJson = (await configRes.json()) as PaymentConfig;
        setPaymentConfig(configJson);
        if (!selectedPlanCode && configJson.plans?.length) {
          setSelectedPlanCode(configJson.plans[0].plan_code);
        }
      }
      if (walletsRes.ok) {
        const walletsJson = (await walletsRes.json()) as { wallets?: BoundWallet[] };
        const wallets = Array.isArray(walletsJson.wallets) ? walletsJson.wallets : [];
        setBoundWallets(wallets);
        if (wallets.length && !selectedWallet) setSelectedWallet(wallets[0].address);
      }
      if (configRes.status === 401 || walletsRes.status === 401) {
        setPaymentError("登录会话已过期，请重新登录后再进行钱包绑定或支付。");
      }
    } catch {
      // ignore
    }
  }, [backend?.authenticated, buildAuthedHeaders, selectedPlanCode, selectedWallet]);

  const loadSnapshot = useCallback(async () => {
    setErrorText("");
    try {
      const userPromise = supabaseReady
        ? getSupabaseBrowserClient().auth.getUser()
        : Promise.resolve({ data: { user: null as User | null } });
      const authHeaders = await buildAuthedHeaders(false);
      const backendPromise = fetch("/api/auth/me", { cache: "no-store", headers: authHeaders });
      const [userResult, backendResult] = await Promise.all([userPromise, backendPromise]);
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

  const userId = backend?.user_id || user?.id || "";
  const isAuthenticated = Boolean(userId);
  const email = backend?.email || user?.email || "";
  const displayName = String(user?.user_metadata?.full_name || "").trim() || (email ? String(email).split("@")[0] : "") || "PolyWeather 用户";
  const initials = (displayName.slice(0, 2) || "PW").toUpperCase();
  const providerRaw = normalizeProvider(user);
  const provider = providerRaw ? providerRaw.toUpperCase() : "--";
  const locale = typeof navigator !== "undefined" ? navigator.language : "zh-CN";
  const lastSignIn = formatTime(user?.last_sign_in_at, locale);
  const joinedAt = formatTime(user?.created_at, locale);
  const updatedAtLabel = formatTime(updatedAt, locale);

  const modeLabel = useMemo(() => {
    const mode = String(backend?.entitlement_mode || "").trim().toLowerCase();
    if (mode === "supabase_required") return "Supabase 强制登录";
    if (mode === "supabase_optional") return "Supabase 可选登录";
    if (mode === "legacy_token") return "Legacy Token 鉴权";
    if (mode === "disabled") return "未启用鉴权";
    return "未知模式";
  }, [backend?.entitlement_mode]);

  const backendStatus = useMemo(() => {
    if (backend?.authenticated) return "通过";
    if (backend?.auth_required) return "未登录";
    return "游客模式";
  }, [backend?.authenticated, backend?.auth_required]);

  const subscriptionRequirement = backend?.subscription_required ? "已启用订阅校验" : "当前未强制订阅";
  const subscriptionResult = !backend?.subscription_required ? "当前未强制订阅" : backend?.subscription_active ? "有效订阅" : "无有效订阅";
  const isSubscribed = Boolean(backend?.subscription_active);

  const bindCommand = userId ? `/bind ${userId}${email ? ` ${email}` : ""}` : "/bind <supabase_user_id> <email>";

  const copyBindCommand = async () => {
    try {
      await navigator.clipboard.writeText(bindCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const planList = paymentConfig?.plans || [];
  const monthlyPlanList = planList.filter((plan) => String(plan.plan_code || "").trim().toLowerCase() === "pro_monthly");
  const effectivePlanList = monthlyPlanList.length ? monthlyPlanList : planList;
  const selectedPlan = effectivePlanList.find((plan) => plan.plan_code === selectedPlanCode) || effectivePlanList[0];
  const paymentFeatureReady = Boolean(paymentConfig?.enabled && paymentConfig?.configured);
  const hasPayingWallet = Boolean(String(selectedWallet || walletAddress || boundWallets[0]?.address || "").trim());

  const pointsRaw = Number(user?.user_metadata?.points ?? user?.user_metadata?.total_points ?? 0);
  const weeklyPointsRaw = Number(user?.user_metadata?.weekly_points ?? 0);
  const weeklyRankRaw = user?.user_metadata?.weekly_rank;
  const totalPoints = Number.isFinite(pointsRaw) ? Math.max(0, pointsRaw) : 0;
  const weeklyPoints = Number.isFinite(weeklyPointsRaw) ? Math.max(0, weeklyPointsRaw) : 0;
  const weeklyRank = weeklyRankRaw == null ? "--" : String(weeklyRankRaw);

  const billing = useMemo(() => {
    const price = Number(selectedPlan?.amount_usdc || 5);
    const pointsPerUsdc = 500;
    const maxDiscount = 3;
    const pointsUsed = Math.min(totalPoints, pointsPerUsdc * maxDiscount);
    const discountAmount = usePoints ? Math.min(maxDiscount, pointsUsed / pointsPerUsdc) : 0;
    return { price, pointsUsed, discountAmount, payAmount: Math.max(0, price - discountAmount) };
  }, [selectedPlan?.amount_usdc, totalPoints, usePoints]);

  useEffect(() => {
    if (isSubscribed) setShowOverlay(false);
  }, [isSubscribed]);

  const waitForReceipt = async (txHash: string, timeoutMs = 120000, pollMs = 3000) => {
    const eth = window.ethereum;
    if (!eth) throw new Error("MetaMask not found");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = (await eth.request({ method: "eth_getTransactionReceipt", params: [txHash] })) as { status?: string } | null;
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
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const address = String(accounts?.[0] || "").toLowerCase();
      if (!address) throw new Error("钱包账户为空");

      const authHeaders = await buildAuthedHeaders(true);
      if (!authHeaders.Authorization) throw new Error("登录会话失效，请重新登录后再绑定钱包。");

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

      const challengeJson = (await challengeRes.json()) as { nonce?: string; message?: string };
      const message = String(challengeJson.message || "");
      const nonce = String(challengeJson.nonce || "");
      if (!message || !nonce) throw new Error("challenge payload invalid");

      const signature = (await eth.request({ method: "personal_sign", params: [message, address] })) as string;
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

    const payingWallet = String(selectedWallet || walletAddress || boundWallets[0]?.address || "").toLowerCase();
    if (!payingWallet) {
      setPaymentError("请先绑定钱包。");
      return;
    }

    setPaymentBusy(true);
    try {
      const authHeaders = await buildAuthedHeaders(true);
      if (!authHeaders.Authorization) throw new Error("登录会话失效，请重新登录后再支付。");

      const currentChainIdHex = String((await eth.request({ method: "eth_chainId" })) || "");
      const targetChainId = Number(paymentConfig.chain_id || 137);
      const targetChainHex = `0x${targetChainId.toString(16)}`;
      if (currentChainIdHex.toLowerCase() !== targetChainHex.toLowerCase()) {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainHex }] });
      }

      const createRes = await fetch("/api/payments/intents", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          plan_code: selectedPlan?.plan_code || "pro_monthly",
          payment_mode: "strict",
          allowed_wallet: payingWallet,
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
      if (!intentId || !txPayload?.to || !txPayload?.data) throw new Error("intent payload invalid");
      setLastIntentId(intentId);

      const tokenAddress = String(txPayload.token_address || "").toLowerCase();
      const amountUnits = BigInt(String(txPayload.amount_units || "0"));
      if (!tokenAddress.startsWith("0x") || amountUnits <= 0n) throw new Error("intent token/amount invalid");

      const allowanceHex = (await eth.request({
        method: "eth_call",
        params: [{ to: tokenAddress, data: buildAllowanceCalldata(payingWallet, txPayload.to) }, "latest"],
      })) as string;
      const allowance = BigInt(String(allowanceHex || "0x0"));

      if (allowance < amountUnits) {
        setPaymentInfo("检测到授权不足，正在发起 USDC 授权...");
        const approveHash = (await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: payingWallet, to: tokenAddress, data: buildApproveCalldata(txPayload.to, amountUnits), value: "0x0" }],
        })) as string;
        await waitForReceipt(String(approveHash || ""));
        setPaymentInfo("USDC 授权成功，正在发起支付...");
      } else {
        setPaymentInfo("授权额度充足，正在发起支付...");
      }

      const txHash = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: payingWallet, to: txPayload.to, data: txPayload.data, value: txPayload.value || "0x0" }],
      })) as string;
      const txHashNorm = String(txHash || "").toLowerCase();
      setLastTxHash(txHashNorm);

      const submitRes = await fetch(`/api/payments/intents/${intentId}/submit`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ tx_hash: txHashNorm, from_address: payingWallet }),
      });
      if (!submitRes.ok) {
        const raw = (await submitRes.text()).slice(0, 350);
        throw new Error(`submit tx failed: ${raw}`);
      }

      const confirmRes = await fetch(`/api/payments/intents/${intentId}/confirm`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ tx_hash: txHashNorm }),
      });
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
      router.push("/auth/login?next=%2Faccount");
      return;
    }
    if (!paymentFeatureReady) {
      setPaymentError("支付服务未配置完成，请稍后再试。");
      return;
    }
    if (!hasPayingWallet) {
      await connectAndBindWallet();
      return;
    }
    await createIntentAndPay();
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0b0f1a] p-4 font-sans text-slate-200 md:p-8">
      <div className="pointer-events-none absolute -right-24 -top-20 h-[620px] w-[620px] rounded-full bg-blue-600/15 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 h-[620px] w-[620px] rounded-full bg-indigo-600/15 blur-[130px]" />

      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <header className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <Link href="/" className="group rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:bg-white/10 hover:text-white" title="返回首页">
              <ChevronLeft size={20} className="transition-transform group-hover:-translate-x-0.5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">账户中心</h1>
              <p className="text-sm text-slate-500">积分体系 v4.3 · 管理身份、订阅与 Bot 绑定</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isSubscribed && paymentFeatureReady ? (
              <button type="button" onClick={() => setShowOverlay(true)} className="flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-400 transition hover:bg-yellow-500/20">
                <Crown size={16} /> 升级 Pro
              </button>
            ) : null}
            <button type="button" onClick={() => void onRefresh()} disabled={refreshing || loading} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm transition hover:bg-white/10 disabled:opacity-70">
              {refreshing || loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} 刷新
            </button>
            {isAuthenticated ? (
              <button type="button" onClick={() => void onSignOut()} className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/20">
                <LogOut size={16} /> 退出
              </button>
            ) : (
              <Link href="/auth/login?next=%2Faccount" className="flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-300 transition hover:bg-blue-500/20">
                <LogIn size={16} /> 登录 / 注册
              </Link>
            )}
          </div>
        </header>

        {errorText ? <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">加载失败: {errorText}</div> : null}
        {!supabaseReady ? <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 未配置。</div> : null}

        <main className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-br from-white/10 to-transparent p-8 shadow-2xl backdrop-blur-md lg:col-span-8">
            <div className="absolute right-0 top-0 p-6"><span className="font-mono text-xs text-slate-500">最近同步: {updatedAtLabel}</span></div>
            <div className="flex flex-col items-center gap-8 md:flex-row">
              <div className="relative">
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-400 text-3xl font-bold text-white shadow-xl shadow-blue-500/30">{initials}</div>
                <div className="absolute -bottom-2 -right-2 rounded-xl border-4 border-[#0b0f1a] bg-yellow-500 p-1.5 text-black"><Crown size={16} fill="currentColor" /></div>
              </div>
              <div className="flex-grow text-center md:text-left">
                <div className="mb-2 flex flex-col items-center gap-3 md:flex-row md:justify-start">
                  <h2 className="text-3xl font-bold text-white">{displayName}</h2>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${isSubscribed ? "border-blue-500/40 bg-blue-500/20 text-blue-300" : "border-white/10 bg-slate-700/40 text-slate-400"}`}>{isSubscribed ? "PRO MEMBER" : "FREE TIER"}</span>
                  <span className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400"><UserCheck size={12} /> {isAuthenticated ? "已登录" : "游客"}</span>
                </div>
                <p className="mb-3 font-mono text-sm text-slate-400">{email || "--"}</p>
                <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400 md:justify-start">
                  <span className="flex items-center gap-1.5"><Hash size={14} /> {userId ? `${userId.slice(0, 12)}...` : "--"}</span>
                  <span className="flex items-center gap-1.5"><Clock size={14} /> 加入时间: {joinedAt}</span>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="min-w-[150px] rounded-2xl border border-white/5 bg-black/40 px-6 py-4 text-center"><p className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">总积分</p><p className="flex items-center justify-center gap-2 text-xl font-bold text-white"><Coins size={16} className="text-yellow-500" /> {totalPoints.toLocaleString("en-US")}</p></div>
                <div className="min-w-[150px] rounded-2xl border border-blue-500/25 bg-blue-500/10 px-6 py-4 text-center"><p className="mb-1 text-[10px] uppercase tracking-widest text-blue-300">周排行</p><p className="flex items-center justify-center gap-2 text-xl font-bold text-white"><Trophy size={16} className="text-amber-400" /> #{weeklyRank}</p><p className="mt-1 text-[11px] text-blue-200/80">本周积分: {weeklyPoints}</p></div>
              </div>
            </div>
          </section>

          <section className="flex flex-col justify-between rounded-[2.5rem] border border-indigo-500/30 bg-gradient-to-br from-indigo-600/20 to-purple-600/20 p-6 shadow-xl lg:col-span-4">
            <div>
              <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-white"><Sparkles size={18} className="text-yellow-400" /> 周榜奖励</h3>
              <div className="space-y-3 text-sm"><div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3"><span>Top 1</span><span className="text-xs font-bold text-yellow-400">+500 pts & 7D Pro</span></div><div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3"><span>Top 2-3</span><span className="text-xs font-bold text-slate-200">+300 pts & 3D Pro</span></div><div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3"><span>Top 4-10</span><span className="text-xs font-bold text-orange-300">+150 pts</span></div></div>
            </div>
            <div className="mt-6 flex items-start gap-2 rounded-xl bg-black/25 p-3"><Info size={14} className="mt-0.5 shrink-0 text-slate-500" /><p className="text-[11px] text-slate-500">周榜每周一结算。发言积分永久累计，可用于订阅抵扣。</p></div>
          </section>

          <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm lg:col-span-6">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-blue-400"><Shield size={16} /> 会员与权限</h3>
            <InfoItem icon={Shield} label="鉴权模式" value={modeLabel} status="primary" />
            <InfoItem icon={UserIcon} label="后端状态" value={backendStatus} />
            <InfoItem icon={Crown} label="订阅要求" value={subscriptionRequirement} />
            <InfoItem icon={ShieldCheck} label="订阅结果" value={subscriptionResult} />
          </section>

          <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm lg:col-span-6">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-indigo-400"><Fingerprint size={16} /> 身份信息</h3>
            <InfoItem icon={Mail} label="邮箱" value={email || "--"} />
            <InfoItem icon={Hash} label="用户 ID" value={userId || "--"} />
            <InfoItem icon={LogIn} label="登录方式" value={provider} />
            <InfoItem icon={Clock} label="最近登录" value={lastSignIn} />
          </section>

          <section className="relative lg:col-span-12">
            <div className={`grid grid-cols-1 gap-6 rounded-[2rem] border border-cyan-500/25 bg-gradient-to-r from-cyan-600/10 to-indigo-600/10 p-6 transition-all duration-500 md:grid-cols-2 ${!isSubscribed && showOverlay ? "pointer-events-none select-none blur-md grayscale-[0.3] opacity-30" : ""}`}>
              <div className="rounded-2xl border border-cyan-400/20 bg-black/20 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-base font-bold text-cyan-200">
                    <Wallet size={18} /> 已绑定钱包
                  </h3>
                  <button
                    type="button"
                    onClick={() => void connectAndBindWallet()}
                    disabled={paymentBusy || !isAuthenticated}
                    className="rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    连接并绑定 MetaMask
                  </button>
                </div>

                {!isAuthenticated ? (
                  <p className="text-sm text-slate-400">请先登录，再进行钱包绑定与支付。</p>
                ) : boundWallets.length ? (
                  <div className="space-y-2">
                    {boundWallets.map((wallet) => {
                      const active = String(selectedWallet || walletAddress).toLowerCase() === String(wallet.address || "").toLowerCase();
                      return (
                        <button
                          type="button"
                          key={`${wallet.chain_id}-${wallet.address}`}
                          onClick={() => setSelectedWallet(wallet.address)}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${active ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
                        >
                          <span className="font-mono text-xs">{shortAddress(wallet.address)}</span>
                          <span className="text-[11px] text-slate-400">
                            Chain #{wallet.chain_id}
                            {wallet.is_primary ? " · Primary" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">暂无已绑定钱包。</p>
                )}
              </div>

              <div className="rounded-2xl border border-cyan-400/20 bg-black/20 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-base font-bold text-cyan-200">
                    <CreditCard size={18} /> 选择套餐并支付
                  </h3>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                    Chain #{paymentConfig?.chain_id ?? 137}
                  </span>
                </div>

                {paymentFeatureReady ? (
                  <>
                    <div className="space-y-2">
                      {effectivePlanList.length ? (
                        effectivePlanList.map((plan) => {
                          const checked = (selectedPlan?.plan_code || "") === plan.plan_code;
                          return (
                            <button
                              type="button"
                              key={plan.plan_code}
                              onClick={() => setSelectedPlanCode(plan.plan_code)}
                              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 transition ${checked ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                            >
                              <div className="flex items-center gap-3">
                                <span className={`h-4 w-4 rounded-full border ${checked ? "border-cyan-300 bg-cyan-300 shadow-[0_0_0_3px_rgba(34,211,238,0.25)]" : "border-slate-500"}`} />
                                <span className="font-medium text-slate-100">{planDisplayName(plan.plan_code)}</span>
                              </div>
                              <span className="text-sm text-cyan-100">{plan.amount_usdc} USDC / {plan.duration_days} 天</span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                          套餐配置为空，请检查后端计划配置。
                        </div>
                      )}
                    </div>

                    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-slate-400">积分抵扣</span>
                        <button
                          type="button"
                          onClick={() => setUsePoints((v) => !v)}
                          className={`h-5 w-10 rounded-full transition ${usePoints ? "bg-indigo-500" : "bg-slate-700"}`}
                        >
                          <span className={`mt-1 block h-3 w-3 rounded-full bg-white transition ${usePoints ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>最多可抵扣 $3（500 分 = $1）</span>
                        <span>消耗积分: {usePoints ? billing.pointsUsed : 0}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm text-slate-300">应付金额</span>
                        <span className="text-xl font-bold text-white">${billing.payAmount.toFixed(2)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void createIntentAndPay()}
                      disabled={paymentBusy || !isAuthenticated || !hasPayingWallet || !selectedPlan}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-900/40 transition hover:from-cyan-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {paymentBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      创建订单并支付
                    </button>
                  </>
                ) : (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                    支付功能暂未启用或未配置完成。
                  </div>
                )}

                {paymentInfo ? <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{paymentInfo}</div> : null}
                {paymentError ? <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{paymentError}</div> : null}
                {lastIntentId ? <div className="mt-2 text-[11px] text-slate-500">Intent: {lastIntentId}</div> : null}
                {lastTxHash ? <div className="mt-1 text-[11px] text-slate-500">Tx: {shortAddress(lastTxHash)}</div> : null}
              </div>
            </div>

            {!isSubscribed && showOverlay ? (
              <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
                <div className="relative w-full max-w-2xl rounded-[2.5rem] border border-white/10 bg-[#161b2a]/90 p-8 text-center shadow-[0_0_90px_-10px_rgba(79,70,229,0.35)] backdrop-blur-2xl md:p-12">
                  <button
                    type="button"
                    onClick={() => setShowOverlay(false)}
                    className="absolute right-5 top-5 rounded-full bg-white/5 p-2 text-slate-500 transition hover:bg-white/10 hover:text-white"
                    title="稍后再说"
                  >
                    <X size={18} />
                  </button>

                  <div className="absolute -top-10 left-1/2 flex h-20 w-20 -translate-x-1/2 items-center justify-center rounded-3xl bg-gradient-to-tr from-yellow-500 to-amber-400 text-white shadow-2xl rotate-12">
                    <Crown size={38} />
                  </div>

                  <h2 className="mt-6 text-3xl font-bold text-white">开启 PolyWeather Pro</h2>
                  <p className="mx-auto mt-3 max-w-lg text-slate-400">
                    解锁今日日内分析、历史对账、未来日期分析等 Pro 功能。
                  </p>

                  <div className="mt-8 grid grid-cols-1 gap-3 text-left md:grid-cols-2">
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200"><BadgeCheck size={16} className="text-cyan-300" /> 今日日内分析</div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200"><BadgeCheck size={16} className="text-cyan-300" /> 历史对账</div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200"><BadgeCheck size={16} className="text-cyan-300" /> 未来日期分析</div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200"><BadgeCheck size={16} className="text-cyan-300" /> 无广告体验</div>
                  </div>

                  <div className="mt-8 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>月付套餐</span>
                      <span>USD {selectedPlan?.amount_usdc || "5"} / 30天</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm text-slate-300">
                      <span>积分抵扣</span>
                      <span>-USD {billing.discountAmount.toFixed(2)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                      <span className="text-slate-300">应付总计</span>
                      <span className="text-2xl font-black text-white">USD {billing.payAmount.toFixed(2)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleOverlayCheckout()}
                    disabled={paymentBusy}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-4 text-lg font-bold text-white shadow-xl shadow-blue-900/40 transition hover:from-blue-500 hover:to-indigo-500 disabled:opacity-70"
                  >
                    {paymentBusy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                    {isAuthenticated ? "连接钱包并支付" : "登录后支付"}
                  </button>

                  <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Lock size={12} /> 所有交易均在链上确认并加密传输
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="relative overflow-hidden rounded-[2rem] border border-blue-500/25 bg-gradient-to-r from-blue-600/10 to-indigo-600/10 p-6 lg:col-span-12">
            <Bot size={150} className="pointer-events-none absolute -bottom-8 -right-8 text-white/5" />
            <div className="relative z-10">
              <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-blue-300">
                <Bot size={20} /> Bot 绑定
              </h3>
              <p className="mb-4 text-sm text-slate-300">
                发送以下命令到 Telegram Bot，绑定网页身份并同步权限状态。
              </p>
              <div className="flex flex-col gap-2 md:flex-row">
                <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-xs text-cyan-200">
                  {bindCommand}
                </code>
                <button
                  type="button"
                  onClick={() => void copyBindCommand()}
                  className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-500"
                >
                  {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                  {copied ? "已复制" : "复制命令"}
                </button>
              </div>
            </div>
          </section>
        </main>

        <footer className="mt-12 text-center text-[10px] uppercase tracking-[0.25em] text-slate-600">
          PolyWeather Global Meteorological Engine
        </footer>
      </div>
    </div>
  );
}
