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
import {
  assertExpectedPaymentReceiver,
  EXPECTED_PAYMENT_RECEIVER_ADDRESS,
} from "@/lib/payment-receiver";
import { markAnalyticsOnce, trackAppEvent } from "@/lib/app-analytics";
import { useI18n } from "@/hooks/useI18n";
import { UnlockProOverlay } from "@/components/subscription/UnlockProOverlay";

import type {
  AuthMeResponse,
  BoundWallet,
  ConnectBindOptions,
  CreatedIntent,
  Eip6963ProviderDetail,
  EvmProvider,
  InjectedProviderOption,
  IntentStatusResponse,
  PaymentConfig,
  PaymentTokenOption,
  PaymentRecoveryState,
  ProviderMode,
  ProviderSelection,
  TelegramPricing,
} from "./types";
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  PAYMENT_RECOVERY_TTL_MS,
  SUBSCRIPTION_HELP_HREF,
  TELEGRAM_BOT_URL,
  TELEGRAM_GROUP_URL,
  TELEGRAM_TOPICS_GROUP_URL,
  WALLETCONNECT_PROJECT_ID,
  WALLETCONNECT_POLYGON_RPC_URL,
  WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
} from "./constants";
import { InfoRow, PlusIcon } from "./AccountInfoRow";
import {
  chainIdToDisplayName,
  clearStoredPaymentRecovery,
  formatTime,
  parseSubscriptionExpiry,
  shortAddress,
} from "./formatters";
import {
  buildAllowanceCalldata,
  buildApproveCalldata,
  buildBalanceOfCalldata,
  formatTokenUnits,
  normalizePaymentError,
  requestWalletWithTimeout,
} from "./payment-utils";
import { createAccountCopy } from "./account-copy";
import { usePaymentState } from "./usePaymentState";
import {
  eip6963Providers,
  getEvmProvider,
  getEvmWalletLabel,
  getWalletConnectProvider,
  isWalletConnectResetError,
  listInjectedProviders,
  resetWalletConnectProvider,
} from "./wallet";

// --- Main Component ---

export function AccountCenter() {
  const router = useRouter();
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const copy = useMemo(() => createAccountCopy(isEn), [isEn]);

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
  const {
    paymentBusy,
    setPaymentBusy,
    paymentInfo,
    setPaymentInfo,
    paymentError,
    setPaymentError,
    lastIntentId,
    setLastIntentId,
    lastTxHash,
    setLastTxHash,
    telegramBindOpening,
    setTelegramBindOpening,
    manualPayment,
    setManualPayment,
    manualTxHash,
    setManualTxHash,
    txValidation,
    setTxValidation,
    paymentMethodTab,
    setPaymentMethodTab,
    lastPaymentStartedAt,
    setLastPaymentStartedAt,
    clearPaymentMessages,
    clearPaymentState,
  } = usePaymentState();
  const [showSecondarySections, setShowSecondarySections] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [telegramBindUrl, setTelegramBindUrl] = useState("");

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
    if (!authIsAuthenticated || !authUserId) return;
    const actorKey = authUserId.toLowerCase();
    if (markAnalyticsOnce(`signup_completed:${actorKey}`, "local")) {
      trackAppEvent("signup_completed", {
        entry: "account_center",
        user_id: authUserId,
      });
    }
    if (markAnalyticsOnce(`dashboard_active:${actorKey}`, "session")) {
      trackAppEvent("dashboard_active", {
        entry: "account_center",
        user_id: authUserId,
      });
    }
  }, [authIsAuthenticated, authUserId]);

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
    const attempt = async (retry: boolean): Promise<void> => {
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
        if (retry && backendResult.status === 401) {
          // Supabase session may not be hydrated yet; wait and retry once.
          await new Promise((r) => setTimeout(r, 1200));
          return attempt(false);
        }
        const raw = (await backendResult.text()).slice(0, 260);
        throw new Error(`HTTP ${backendResult.status} ${raw}`.trim());
      }
      const backendJson = (await backendResult.json()) as AuthMeResponse;
      setBackend(backendJson);
      setUpdatedAt(new Date().toISOString());
    };
    try {
      await attempt(true);
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
    clearPaymentState();
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

  const handleSubmit409 = useCallback(
    async (intentId: string, txHashNorm: string, raw: string) => {
      const lowerRaw = raw.toLowerCase();
      // If intent was already confirmed (maybe by confirm loop), reconcile
      if (
        lowerRaw.includes("已支付") ||
        lowerRaw.includes("already confirmed") ||
        lowerRaw.includes("already paid")
      ) {
        const ok = await reconcileLatestPayment();
        if (ok) return;
        setPaymentInfo("该订单已支付，正在恢复订阅...");
        await loadSnapshot();
        await loadPaymentSnapshot();
        return;
      }
      // If intent expired, tell user to create a new order
      if (lowerRaw.includes("expired")) {
        throw new Error("支付订单已过期（30分钟有效），请重新创建订单。");
      }
      // Try fetching intent status as fallback
      try {
        const headers = await buildAuthedHeaders(true, false);
        const intentRes = await fetch(`/api/payments/intents/${intentId}`, {
          headers,
          cache: "no-store",
        });
        if (intentRes.ok) {
          const intentJson = (await intentRes.json()) as {
            intent?: { status?: string; tx_hash?: string };
          };
          const status = intentJson.intent?.status;
          if (status === "confirmed") {
            await reconcileLatestPayment();
            const txHash =
              intentJson.intent?.tx_hash || txHashNorm;
            setPaymentInfo(
              `支付已确认，交易: ${shortAddress(txHash)}`,
            );
            setPaymentError("");
            await loadSnapshot();
            await loadPaymentSnapshot();
            return;
          }
          if (status === "expired") {
            throw new Error("支付订单已过期（30分钟有效），请重新创建订单。");
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message !== raw) throw e;
      }
      throw new Error(`submit tx failed: ${raw}`);
    },
    [
      buildAuthedHeaders,
      loadPaymentSnapshot,
      loadSnapshot,
      reconcileLatestPayment,
    ],
  );

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
    clearPaymentState();
    clearStoredPaymentRecovery();
    await resetWalletConnectProvider();
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
          const amount = data.telegram_pricing.amount_usdc || "10";
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
    ? copy.proExpiredTitle
    : showExpiringSoon
      ? copy.proEndsSoonTitle
      : "";
  const subscriptionStatusBody = showExpiredReminder
    ? copy.proExpiredBody
    : showExpiringSoon
      ? copy.proEndsSoonBody
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
  const paymentReceiverAddress = EXPECTED_PAYMENT_RECEIVER_ADDRESS;
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
      backend?.telegram_pricing?.amount_usdc ?? selectedPlan?.amount_usdc ?? 10,
    );
    const planAmount =
      Number.isFinite(parsedPlanAmount) && parsedPlanAmount > 0
        ? parsedPlanAmount
        : 10;

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
    setTelegramBindUrl("");
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
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
      if (popup && !popup.closed) {
        popup.location.href = botUrl;
        setPaymentInfo(
          "已打开 Telegram Bot，请在 Bot 内点击 Start 并确认绑定；完成后刷新本页再申请入群。",
        );
      } else {
        setPaymentInfo(
          "弹窗被拦截，请点击下方链接完成绑定：",
        );
        setTelegramBindUrl(botUrl);
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      setPaymentError(normalizePaymentError(error).message);
    } finally {
      setTelegramBindOpening(false);
    }
  };

  // --- Payment Logic (preserved) ---

  const waitForReceipt = async (
    txHash: string,
    provider?: EvmProvider,
    timeoutMs = 120000,
    pollMs = 3000,
  ) => {
    const eth = provider || getEvmProvider();
    if (!eth) throw new Error("No EVM wallet provider found");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = await requestWalletWithTimeout<{ status?: string } | null>(
        eth,
        {
          method: "eth_getTransactionReceipt",
          params: [txHash],
        },
        "查询授权交易确认",
        15_000,
      );
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
      (await requestWalletWithTimeout<string>(
        eth,
        { method: "eth_chainId" },
        copy.chainReadError,
      )) || "",
    );
    const targetChainHex = `0x${targetChainId.toString(16)}`;
    if (currentChainIdHex.toLowerCase() === targetChainHex.toLowerCase())
      return;
    try {
      await requestWalletWithTimeout(
        eth,
        {
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChainHex }],
        },
        copy.chainSwitchError,
      );
    } catch (err: any) {
      const code = Number(err?.code);
      const msg = String(err?.message || "").toLowerCase();
      
      // If the error code indicates the chain is not added (4902), or it's Polygon (137)
      if (code === 4902 || targetChainId === 137) {
        try {
          await requestWalletWithTimeout(
            eth,
            {
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
            },
            copy.chainAddPolygon,
          );
          return;
        } catch (addErr: any) {
          err = addErr;
        }
      }
      throw new Error(
        `${copy.chainSwitchPrompt} (${err?.message || (isEn ? "Network switch failed" : "网络切换失败")})`,
      );
    }
  };

  const connectAndBindWallet = async (
    mode: ProviderMode = "auto",
    options: ConnectBindOptions = {},
  ): Promise<boolean> => {
    clearPaymentMessages();
    if (!paymentHostAllowed) {
      setPaymentError(
        copy.paymentHostBlocked.replace(
          "{host}",
          allowedPaymentHosts[0] || "polyweather-pro.vercel.app",
        ),
      );
      return false;
    }
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
      const binanceBindHint = walletLabel.toLowerCase().includes("binance")
        ? " Binance 扩展已绑定；如支付卡住，请优先使用 WalletConnect 扫码支付。"
        : "";

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

      const accounts = await requestWalletWithTimeout<string[]>(
        eth,
        { method: "eth_requestAccounts" },
        "连接绑定钱包",
      );
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
          `${walletLabel} 已绑定: ${shortAddress(address)}。${binanceBindHint || "现在可点击“立即订阅并激活服务”。"}`,
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
        `${walletLabel} 绑定成功: ${shortAddress(address)}。${binanceBindHint || "现在可点击“立即订阅并激活服务”。"}`,
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
    clearPaymentMessages();
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
    clearPaymentMessages();
    clearPaymentState();
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
      const activeAccounts = await requestWalletWithTimeout<string[]>(
        eth,
        { method: "eth_requestAccounts" },
        "连接付款钱包",
      );
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
      assertExpectedPaymentReceiver(expectedReceiver, "payment receiver contract");
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

      const balanceHex = await requestWalletWithTimeout<string>(
        eth,
        {
          method: "eth_call",
          params: [
          {
            to: tokenAddress,
            data: buildBalanceOfCalldata(payingWallet),
          },
          "latest",
          ],
        },
        `读取 ${tokenSymbol} 余额`,
      );
      const tokenBalance = BigInt(String(balanceHex || "0x0"));
      if (tokenBalance < amountUnits) {
        const need = formatTokenUnits(amountUnits, tokenDecimals);
        const have = formatTokenUnits(tokenBalance, tokenDecimals);
        throw new Error(
          `支付代币余额不足：需要 ${need} ${tokenSymbol}，当前 ${have} ${tokenSymbol}。请确认你钱包里持有该支付币种。`,
        );
      }

      const allowanceHex = await requestWalletWithTimeout<string>(
        eth,
        {
          method: "eth_call",
          params: [
          {
            to: tokenAddress,
            data: buildAllowanceCalldata(payingWallet, txPayload.to),
          },
          "latest",
          ],
        },
        `读取 ${tokenSymbol} 授权额度`,
      );
      const allowance = BigInt(String(allowanceHex || "0x0"));

      if (allowance < amountUnits) {
        setPaymentInfo(`检测到授权不足，正在发起 ${tokenSymbol} 授权...`);
        const approveParams: Record<string, any> = {
          from: payingWallet,
          to: tokenAddress,
          data: buildApproveCalldata(txPayload.to, amountUnits),
        };
        const approveHash = await requestWalletWithTimeout<string>(
          eth,
          {
            method: "eth_sendTransaction",
            params: [approveParams],
          },
          `发起 ${tokenSymbol} 授权`,
          WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
        );
        await waitForReceipt(String(approveHash || ""), eth);
        approvedInThisRun = true;
        setPaymentInfo(`${tokenSymbol} 授权成功，正在发起支付...`);
      } else {
        setPaymentInfo("授权额度充足，正在发起支付...");
      }

      const payParams: Record<string, any> = {
        from: payingWallet,
        to: txPayload.to,
        data: txPayload.data,
      };
      if (txPayload.value && txPayload.value !== "0x0" && txPayload.value !== "0") {
        payParams.value = txPayload.value;
      }
      
      const txHash = await requestWalletWithTimeout<string>(
        eth,
        {
          method: "eth_sendTransaction",
          params: [payParams],
        },
        "发起支付交易",
        WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
      );
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
        if (submitRes.status === 409) {
          await handleSubmit409(intentId, txHashNorm, raw);
          return;
        }
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
    clearPaymentMessages();
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
      assertExpectedPaymentReceiver(
        direct.receiver_address,
        "manual payment receiver",
      );
      setLastIntentId(intentId);
      setManualPayment(direct);
      setPaymentMethodTab("manual");
      setShowOverlay(false);
      setPaymentInfo(
        `手动转账订单已创建：请在 Polygon 网络转 ${direct.amount_usdc} ${direct.token_symbol || selectedTokenLabel} 到 ${direct.receiver_address}，请在下方【手动转账】面板中查看详情并复制地址，完成后提交 tx hash。`,
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
        if (submitRes.status === 409) {
          await handleSubmit409(intentId, txHashNorm, raw);
          return;
        }
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
      setTxValidation({ loading: false, checked: false });
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

  const validateTxHash = useCallback(
    async (intentId: string, hash: string) => {
      const hashNorm = String(hash || "").trim().toLowerCase();
      if (!hashNorm.startsWith("0x") || hashNorm.length !== 66) {
        setTxValidation({ loading: false, checked: false });
        return;
      }
      setTxValidation({ loading: true, checked: false });
      try {
        const headers = await buildAuthedHeaders(true, false);
        const res = await fetch(`/api/payments/intents/${intentId}/validate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ tx_hash: hashNorm }),
        });
        const json = (await res.json()) as {
          valid?: boolean;
          reason?: string;
          detail?: string;
          checks?: Record<string, unknown>;
        };
        setTxValidation({
          loading: false,
          checked: true,
          valid: Boolean(json.valid),
          reason: json.reason,
          detail: json.detail,
          checks: json.checks,
        });
      } catch {
        setTxValidation({ loading: false, checked: false });
      }
    },
    [buildAuthedHeaders],
  );

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
      <div className="flex h-screen w-full items-center justify-center bg-[#f4f7fb]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
          <p className="font-medium text-slate-500">{copy.loadingAccount}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center overflow-hidden bg-[#f4f7fb] p-4 font-sans text-slate-900 md:p-8">
      <div className="absolute inset-x-0 top-0 h-20 border-b border-slate-200 bg-white"></div>

      {/* Header */}
      <header className="w-full max-w-6xl flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 z-20">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="group rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition-all hover:border-slate-300 hover:text-slate-950 active:scale-95"
            title={copy.backHome}
            aria-label={copy.backHome}
          >
            <ChevronLeft
              size={20}
              className="group-hover:-translate-x-0.5 transition-transform"
            />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-950">
              {copy.accountCenter}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!showOverlay && canOpenCheckoutOverlay && (
            <button
              onClick={() => setShowOverlay(true)}
              className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition-all hover:bg-amber-100"
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
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:text-slate-950 disabled:opacity-50"
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
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition-all hover:bg-red-100"
            >
              <LogOut size={16} /> {copy.signOut}
            </button>
          ) : (
            <Link
              href="/auth/login?next=%2Faccount"
              className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition-all hover:bg-blue-100"
            >
              <LogIn size={16} /> {copy.signIn}
            </Link>
          )}
        </div>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 z-10 relative">
        {(showExpiringSoon || showExpiredReminder) && (
          <div className="lg:col-span-12 rounded-2xl border border-amber-300 bg-amber-50 px-6 py-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
                  <Crown size={16} />
                  <span>{subscriptionStatusTitle}</span>
                </div>
                <p className="mt-1 text-sm text-amber-900">
                  {subscriptionStatusBody}
                </p>
                {subscriptionStatusMeta ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {subscriptionStatusMeta}
                  </p>
                ) : null}
                {billing.canRedeem ? (
                    <p className="mt-2 text-xs text-emerald-700">
                    当前可用 {billing.pointsUsed} 积分抵扣 $
                    {billing.discountAmount.toFixed(2)}， 续费时会自动生效。
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setShowOverlay(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-800 transition-all hover:bg-amber-100"
              >
                <Crown size={16} />
                {showExpiredReminder ? copy.renewNow : copy.upgradePro}
              </button>
            </div>
          </div>
        )}

        {/* User Card */}
        <div className="flex flex-col items-center gap-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm lg:col-span-8 md:flex-row">
          <div className="relative">
            <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-blue-200 bg-blue-600 text-3xl font-bold text-white shadow-sm">
              {initials}
            </div>
            <div
              className={`absolute -bottom-2 -right-2 rounded-lg border-4 border-white p-1.5 ${isSubscribed ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-400"}`}
            >
              <Crown size={16} fill="currentColor" />
            </div>
          </div>
          <div className="flex-grow text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-3 mb-1">
              <h2 className="text-3xl font-bold text-slate-950">{displayName}</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${isSubscribed ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}
              >
                {isSubscribed
                  ? copy.proMember
                  : copy.freeTier}
              </span>
            </div>
            <p className="mb-4 font-mono text-sm text-slate-500">
              {email || copy.guestUser}
            </p>
            <div className="flex flex-wrap justify-center md:justify-start gap-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Hash size={14} />{" "}
                <span className="font-mono">
                  {userId ? `${userId.substring(0, 12)}...` : "--"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Clock size={14} />{" "}
                <span>
                  {copy.joinedAt}: {joinedAt}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="min-w-[140px] rounded-xl border border-slate-200 bg-slate-50 px-6 py-4 text-center">
              <p className="mb-1 text-[10px] uppercase text-slate-500">
                {copy.totalPoints}
              </p>
              <p className="flex items-center justify-center gap-2 text-xl font-bold text-slate-950">
                <Coins size={16} className="text-yellow-500" />{" "}
                {totalPoints.toLocaleString()}
              </p>
            </div>
            <div className="min-w-[140px] rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-center">
              <p className="mb-1 text-[10px] font-bold uppercase text-emerald-700">
                {copy.weeklyPoints}
              </p>
              <p className="flex items-center justify-center gap-2 text-xl font-bold text-slate-950">
                <TrendingUp size={16} className="text-emerald-400" />{" "}
                {weeklyPoints.toLocaleString()}
              </p>
            </div>
            <div className="min-w-[140px] rounded-xl border border-blue-200 bg-blue-50 px-6 py-4 text-center">
              <p className="mb-1 text-[10px] font-bold uppercase text-blue-700">
                {copy.weeklyRank}
              </p>
              <p className="flex items-center justify-center gap-2 text-xl font-bold text-slate-950">
                <Trophy size={16} className="text-amber-400" />{" "}
                {weeklyRank === "--" ? weeklyRank : `#${weeklyRank}`}
              </p>
            </div>
          </div>
        </div>

        {/* Weekly Ranking Motivation */}
        {showSecondarySections ? (
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-4">
            <div>
              <h3 className="mb-6 flex items-center gap-2 text-lg font-bold text-slate-950">
                <Sparkles size={20} className="text-amber-500" />{" "}
                {copy.weeklyRewards}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm flex items-center gap-2">
                    <div className="w-5 h-5 bg-yellow-500 rounded text-black font-bold text-[10px] flex items-center justify-center">
                      1
                    </div>{" "}
                    Top 1
                  </span>
                  <span className="text-xs font-bold text-amber-600">
                    +200 积分 & 7天Pro
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm flex items-center gap-2">
                    <div className="w-5 h-5 bg-slate-300 rounded text-black font-bold text-[10px] flex items-center justify-center">
                      2
                    </div>{" "}
                    Top 2-3
                  </span>
                  <span className="text-xs font-bold text-slate-600">
                    +100 积分
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
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
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <Info size={14} className="text-slate-500 mt-0.5 shrink-0" />
              <p className="text-[10px] text-slate-500 leading-normal italic">
                积分规则：群内有效发言（自动防刷检测）+
                每日首条发言额外奖励。每周一零点结算周榜，所有活跃用户均享参与奖。
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-4">
            <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
            <div className="mt-4 space-y-2">
              <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
            </div>
          </div>
        )}

        {/* Subscription Info & Paywall */}
        <div className="lg:col-span-12 relative">
          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-all duration-700 ${canOpenCheckoutOverlay && showOverlay ? "blur-md grayscale-[0.3] opacity-30 select-none pointer-events-none" : ""}`}
          >
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold uppercase text-blue-700">
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
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold uppercase text-indigo-700">
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
                <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs text-cyan-800">
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

        {/* Telegram Bot Section & Payment Details */}
        {showSecondarySections ? (
          <div className="lg:col-span-12 grid grid-cols-1 md:flex gap-6">
            {canAccessPaidTelegramGroup && (
              <section className="group relative flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <Bot
                size={140}
                className="absolute -right-8 -bottom-8 -rotate-12 text-slate-100 transition-transform duration-1000 group-hover:rotate-0"
              />
              <div className="relative z-10">
                <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-blue-700">
                  <Bot size={22} /> {copy.telegramBind}
                </h3>
                <p className="mb-6 text-sm text-slate-500">
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
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
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
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      {copy.telegramGroupLink}
                      <ExternalLink size={12} />
                    </Link>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <code className="flex-grow overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-blue-700">
                    {bindCommand}
                  </code>
                  <button
                    onClick={() => void openTelegramBotBindLink()}
                    disabled={telegramBindOpening || !isAuthenticated}
                    className="rounded-xl border border-cyan-700 bg-cyan-600 px-4 py-3 text-xs font-bold text-white shadow-sm transition-all hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                    title={copy.telegramBotBindLink}
                    aria-label={copy.telegramBotBindLink}
                  >
                    {telegramBindOpening ? "..." : copy.telegramBotBindLink}
                  </button>
                  <button
                    onClick={() => handleCopy(bindCommand)}
                    className="rounded-xl border border-blue-700 bg-blue-600 p-4 text-white shadow-sm transition-all hover:bg-blue-700"
                    title={copy.copyCommand}
                    aria-label={copy.copyCommand}
                  >
                    {copied ? <CheckCircle2 size={20} /> : <Copy size={20} />}
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-400">
                  {copy.telegramFallbackHint}
                </p>
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-800">
                  {copy.paymentManualSupport}
                </div>
              </div>
            </section>
            )}

            {/* Payment Details / Wallet Management */}
            <section className={`flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-8 shadow-sm ${
              canAccessPaidTelegramGroup ? "w-full md:w-96" : "w-full"
            }`}>
              <div>
                <h3 className="mb-6 flex items-center gap-2 text-sm font-bold uppercase text-blue-700">
                  <Wallet size={18} /> {copy.paymentMgmt}
                </h3>
                {paymentError ? (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                    {paymentError}
                  </div>
                ) : null}
                {!paymentError && paymentInfo ? (
                  <div className="mb-4 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] text-cyan-800">
                    {paymentInfo}
                    {telegramBindUrl ? (
                      <a
                        href={telegramBindUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block break-all text-cyan-700 underline hover:text-cyan-900"
                      >
                        {telegramBindUrl}
                      </a>
                    ) : null}
                  </div>
                ) : null}
                {!paymentHostAllowed ? (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
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
                    label={copy.paymentNetwork}
                    value={chainIdToDisplayName(paymentConfig?.chain_id)}
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
                    <p className="mb-2 text-[11px] uppercase text-slate-500">
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
                                ? "border-blue-300 bg-blue-50 text-blue-900"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
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

                {/* 支付方式选择 Tabs */}
                <div className="mt-6 border-t border-slate-200 pt-6">
                  <p className="mb-3 text-[10px] font-semibold uppercase text-slate-500">
                    {copy.paymentMethodLabel}
                  </p>
                  <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setPaymentMethodTab("wallet")}
                      className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        paymentMethodTab === "wallet"
                          ? "bg-white text-blue-700 shadow-sm"
                          : "text-slate-500 hover:bg-white/70 hover:text-slate-900"
                      }`}
                    >
                      <Wallet size={12} />
                      {copy.paymentMethodWallet}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethodTab("manual")}
                      className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        paymentMethodTab === "manual"
                          ? "bg-white text-emerald-700 shadow-sm"
                          : "text-slate-500 hover:bg-white/70 hover:text-slate-900"
                      }`}
                    >
                      <ExternalLink size={12} />
                      {copy.paymentMethodManual}
                    </button>
                  </div>

                  {paymentMethodTab === "wallet" ? (
                    <div className="space-y-4">
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        {copy.paymentWalletDesc}
                      </p>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
                        {copy.paymentGasWarning}
                      </div>
                      
                      {boundWallets.length ? (
                        <div className="space-y-3">
                          {boundWallets.map((w) => (
                            <div
                              key={w.address}
                              className={`p-3 rounded-xl border transition-all ${
                                selectedWallet === w.address
                                  ? "border-blue-300 bg-blue-50 text-blue-900"
                                  : "border-slate-200 bg-white text-slate-600"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-mono">
                                  {shortAddress(w.address)}
                                </span>
                                {w.is_primary && (
                                  <span className="text-[8px] bg-blue-500 px-1 rounded text-white font-semibold">
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
                                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 transition-all hover:bg-red-100 disabled:opacity-50"
                                >
                                  <Minus size={12} />
                                  {copy.unbind}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                          <p className="text-xs text-slate-400 italic">
                            {copy.noWallet}
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-2 pt-2">
                        {injectedProviderOptions.length > 1 && (
                          <label className="mb-2 block">
                            <span className="mb-2 block text-[11px] uppercase text-slate-500">
                              {copy.walletExtensionDetected}
                            </span>
                            <select
                              value={selectedInjectedProviderKey}
                              onChange={(event) =>
                                setSelectedInjectedProviderKey(event.target.value)
                              }
                              disabled={paymentBusy}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-xs text-slate-900 outline-none transition-all hover:bg-slate-50 disabled:opacity-60"
                            >
                              {injectedProviderOptions.map((option) => (
                                <option
                                  key={option.key}
                                  value={option.key}
                                  className="bg-white text-slate-900"
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
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-60"
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
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 py-3 text-xs font-bold text-cyan-700 transition-all hover:bg-cyan-100 disabled:opacity-60"
                        >
                          <CreditCard className="w-4 h-4" /> {copy.bindQr}
                        </button>
                        {!walletConnectEnabled && (
                          <p className="text-[11px] text-slate-500 text-center mt-1">
                            {copy.walletConnectMissing}
                            <code className="mx-1">
                              NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
                            </code>
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        {copy.paymentManualDesc}
                      </p>
                      
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-xs font-bold text-emerald-800">
                              {copy.paymentManualTitle}
                            </p>
                            <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">
                              {copy.paymentManualHint}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void createManualPaymentIntent()}
                            disabled={paymentBusy || !isAuthenticated}
                            className="w-full rounded-xl border border-emerald-700 bg-emerald-600 py-2.5 text-xs font-bold text-white transition-all hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {copy.paymentManualCreate}
                          </button>
                        </div>
                        {manualPayment ? (
                          <div className="mt-4 space-y-3 rounded-xl border border-emerald-200 bg-white p-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                                {copy.paymentAmount}
                              </p>
                              <p className="font-mono text-sm font-bold text-slate-950">
                                {manualPayment.amount_usdc}{" "}
                                {manualPayment.token_symbol || selectedTokenLabel}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                                {copy.paymentReceiverLabel}
                              </p>
                              <div className="mt-1 flex gap-2">
                                <code className="min-w-0 flex-1 break-all whitespace-normal rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 font-mono text-[11px] text-blue-800">
                                  {manualPayment.receiver_address}
                                </code>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopy(manualPayment.receiver_address)
                                  }
                                  className="rounded-lg border border-blue-700 bg-blue-600 px-2 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                                >
                                  {copy.paymentCopyAddress}
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                                Tx Hash
                              </p>
                              <input
                                value={manualTxHash}
                                onChange={(event) => {
                                  setManualTxHash(event.target.value);
                                  void validateTxHash(
                                    manualPayment.intent_id ||
                                      lastIntentId ||
                                      "",
                                    event.target.value,
                                  );
                                }}
                                placeholder="0x..."
                                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                              />
                              {txValidation.loading ? (
                                <p className="mt-1 text-[10px] text-slate-500">
                                  验证中...
                                </p>
                              ) : txValidation.checked && txValidation.valid ? (
                                <p className="mt-1 text-[10px] text-emerald-700">
                                  收款地址和金额匹配
                                </p>
                              ) : txValidation.checked &&
                                txValidation.valid === false ? (
                                <p className="mt-1 text-[10px] text-red-700">
                                  {txValidation.reason ===
                                  "tx_not_mined"
                                    ? "交易未上链，请等待"
                                    : txValidation.reason === "receiver_mismatch"
                                      ? "收款地址不匹配！请检查是否转到了正确的地址"
                                      : txValidation.reason ===
                                          "amount_insufficient"
                                        ? "转账金额不足"
                                        : txValidation.reason === "tx_reverted"
                                          ? "该交易已回滚"
                                          : txValidation.detail ||
                                            "验证失败: " +
                                              (txValidation.reason ||
                                                "未知错误")}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => void submitManualPaymentTx()}
                              disabled={
                                paymentBusy ||
                                (txValidation.checked && !txValidation.valid)
                              }
                              className="w-full rounded-xl border border-emerald-700 bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {copy.paymentManualSubmit}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="lg:col-span-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white md:col-span-2" />
            <div className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          </div>
        )}
      </main>

      <footer className="mt-16 text-center text-slate-600 text-[10px] uppercase tracking-[0.3em] font-mono z-10 pb-8">
        PolyWeather Global Meteorological Engine · Powered by AI
      </footer>
    </div>
  );
}

