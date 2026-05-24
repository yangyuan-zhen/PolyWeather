"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getAllowedPaymentHosts,
  getCurrentPaymentHost,
  isPaymentHostAllowed,
} from "@/lib/payment-host";
import {
  assertExpectedPaymentReceiver,
  EXPECTED_PAYMENT_RECEIVER_ADDRESS,
} from "@/lib/payment-receiver";
import { trackAppEvent } from "@/lib/app-analytics";

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
  WALLETCONNECT_POLYGON_RPC_URL,
  WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
} from "./constants";
import { clearStoredPaymentRecovery, shortAddress } from "./formatters";
import {
  buildAllowanceCalldata,
  buildApproveCalldata,
  buildBalanceOfCalldata,
  formatTokenUnits,
  normalizePaymentError,
  requestWalletWithTimeout,
} from "./payment-utils";
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

// ============================================================
export interface UseAccountPaymentParams {
  isEn: boolean;
  supabaseReady: boolean;
  walletConnectEnabled: boolean;
  copy: Record<string, string>;
  backend: AuthMeResponse | null;
  user: User | null;
  setUser: (user: User | null) => void;
  setBackend: (backend: AuthMeResponse | null) => void;
  setErrorText: (text: string) => void;
  setUpdatedAt: (text: string) => void;
  showOverlay: boolean;
  setShowOverlay: (v: boolean) => void;
  usePoints: boolean;
  setUsePoints: (v: boolean) => void;
}

// ============================================================
export function useAccountPayment(params: UseAccountPaymentParams) {
  const {
    isEn,
    supabaseReady,
    walletConnectEnabled,
    copy,
    backend,
    user,
    setUser,
    setBackend,
    setErrorText,
    setUpdatedAt,
    showOverlay,
    setShowOverlay,
    usePoints,
    setUsePoints,
  } = params;

  // ── Base payment state (from usePaymentState) ──────────────
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

  // ── Additional payment/wallet state ──────────────────────
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
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [telegramBindUrl, setTelegramBindUrl] = useState("");

  // ── Derived values ──────────────────────────────────────
  const authUserId = backend?.user_id || user?.id || "";
  const authIsAuthenticated = Boolean(authUserId);
  const paymentReadyForRecovery = Boolean(
    paymentConfig?.enabled && paymentConfig?.configured,
  );
  const hasRecentPaymentRecovery =
    Boolean(
      lastIntentId && lastTxHash && authUserId && lastPaymentStartedAt,
    ) &&
    Date.now() - lastPaymentStartedAt <= PAYMENT_RECOVERY_TTL_MS;
  const allowedPaymentHosts = useMemo(() => getAllowedPaymentHosts(), []);
  const currentPaymentHost = useMemo(() => getCurrentPaymentHost(), []);
  const paymentHostAllowed = useMemo(
    () => isPaymentHostAllowed(currentPaymentHost),
    [currentPaymentHost],
  );

  // ── EIP-6963 Provider sync ──────────────────────────────
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
      if (
        !detail?.provider ||
        typeof detail.provider.request !== "function"
      ) {
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
      { once: false },
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

  // ── getValidAccessToken ──────────────────────────────────
  const getValidAccessToken = useCallback(async (): Promise<string> => {
    if (!supabaseReady)
      throw new Error(
        isEn
          ? "Supabase is not configured. Unable to get auth token."
          : "Supabase 未配置，无法获取登录凭证。",
      );
    const client = getSupabaseBrowserClient();
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
    if (
      cachedToken &&
      (!Number.isFinite(expiresAtSec) || expiresAtSec <= 0)
    ) {
      return cachedToken;
    }
    const {
      data: { session: refreshed },
      error,
    } = await client.auth.refreshSession();
    const refreshedToken = String(refreshed?.access_token || "").trim();
    if (refreshedToken) return refreshedToken;
    if (
      cachedToken &&
      Number.isFinite(expiresAtSec) &&
      expiresAtSec > nowSec
    ) {
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

  // ── buildAuthedHeaders ──────────────────────────────────
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

  // ── resolvePaymentProvider ──────────────────────────────
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
          return { provider: injected, label, mode: "auto" };
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
      if (
        !Array.isArray(existingAccounts) ||
        existingAccounts.length === 0
      ) {
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

  // ── loadPaymentSnapshot ──────────────────────────────────
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
          fetch("/api/payments/config", { cache: "no-store", headers }),
        ),
        authHeadersPromise.then((headers) =>
          fetch("/api/payments/wallets", { cache: "no-store", headers }),
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
          setSelectedTokenAddress(
            (prev) => prev || defaultTokenAddress,
          );
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
          const currentSelected = String(
            selectedWallet || "",
          ).toLowerCase();
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
              String(row.address || "").toLowerCase() ===
              currentWalletAddress,
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

  // ── fetchLatestPaymentConfig ────────────────────────────
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
        throw new Error(copy.loadConfigFailed.replace("{raw}", raw));
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
          setSelectedTokenAddress(
            (prev) => prev || defaultTokenAddress,
          );
        }
      }
      return configJson;
    },
    [buildAuthedHeaders, selectedPlanCode],
  );

  // ── loadSnapshot ──────────────────────────────────────────
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
          await new Promise((r) => setTimeout(r, 1200));
          return attempt(false);
        }
        const raw = (await backendResult.text()).slice(0, 260);
        throw new Error(
          copy.httpError
            .replace("{status}", String(backendResult.status))
            .replace("{raw}", raw),
        );
      }
      const backendJson =
        (await backendResult.json()) as AuthMeResponse;
      setBackend(backendJson);
      setUpdatedAt(new Date().toISOString());
    };
    try {
      await attempt(true);
    } catch (error) {
      setErrorText(String(error));
    }
  }, [buildAuthedHeaders, supabaseReady, copy.httpError]);

  // ── loadPaymentSnapshot effect ────────────────────────────
  useEffect(() => {
    void loadPaymentSnapshot();
  }, [loadPaymentSnapshot]);

  // ── Recovery save effect ────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      !(
        lastIntentId &&
        lastTxHash &&
        authUserId &&
        lastPaymentStartedAt
      )
    ) {
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

  // ── Recovery restore effect ──────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authUserId) return;
    if (lastIntentId && lastTxHash && lastPaymentStartedAt) return;
    const raw =
      window.sessionStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY);
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
        !createdAt ||
        Date.now() - createdAt > PAYMENT_RECOVERY_TTL_MS;
      if (
        expired ||
        !intentId ||
        !txHash ||
        !userId ||
        userId !== authUserId
      ) {
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

  // ── Subscription cleanup effect ──────────────────────────
  useEffect(() => {
    if (!backend?.subscription_active) return;
    clearPaymentState();
    clearStoredPaymentRecovery();
  }, [backend?.subscription_active]);

  // ── Derived payment values ──────────────────────────────
  const planList = paymentConfig?.plans || [];
  const monthlyPlanList = planList.filter(
    (plan) =>
      String(plan.plan_code || "")
        .trim()
        .toLowerCase() === "pro_monthly",
  );
  const effectivePlanList = monthlyPlanList.length
    ? monthlyPlanList
    : planList;
  const selectedPlan =
    effectivePlanList.find(
      (plan) => plan.plan_code === selectedPlanCode,
    ) || effectivePlanList[0];

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

  // ── Points computation ──────────────────────────────────
  const backendPointsRaw = Number(backend?.points);
  const metadataPointsRaw = Number(
    user?.user_metadata?.points ??
      user?.user_metadata?.total_points ??
      0,
  );
  const metadataPointsSafe = Number.isFinite(metadataPointsRaw)
    ? metadataPointsRaw
    : 0;
  const pointsRaw = Number.isFinite(backendPointsRaw)
    ? Math.max(backendPointsRaw, metadataPointsSafe)
    : metadataPointsSafe;
  const totalPoints = Number.isFinite(pointsRaw)
    ? Math.max(0, pointsRaw)
    : 0;

  // ── Billing ──────────────────────────────────────────────
  const billing = useMemo(() => {
    const parsedPlanAmount = Number(
      backend?.telegram_pricing?.amount_usdc ??
        selectedPlan?.amount_usdc ??
        10,
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
      pointsEnabled &&
      maxDiscountUsdc > 0 &&
      totalPoints >= pointsPerUsdc;
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

  // ── reconcileLatestPayment ──────────────────────────────
  const reconcileLatestPayment = useCallback(async () => {
    if (!authIsAuthenticated || reconcileBusy) return false;
    setReconcileBusy(true);
    try {
      const headers = await buildAuthedHeaders(true, true);
      const res = await fetch("/api/payments/reconcile-latest", {
        method: "POST",
        headers,
      });
      if (!res.ok) return false;
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

  // ── handleSubmit409 ────────────────────────────────────
  const handleSubmit409 = useCallback(
    async (intentId: string, txHashNorm: string, raw: string) => {
      const lowerRaw = raw.toLowerCase();
      if (
        lowerRaw.includes("已支付") ||
        lowerRaw.includes("already confirmed") ||
        lowerRaw.includes("already paid")
      ) {
        const ok = await reconcileLatestPayment();
        if (ok) return;
        setPaymentInfo(copy.orderAlreadyPaid);
        await loadSnapshot();
        await loadPaymentSnapshot();
        return;
      }
      if (lowerRaw.includes("expired")) {
        throw new Error(copy.orderExpired);
      }
      try {
        const headers = await buildAuthedHeaders(true, false);
        const intentRes = await fetch(
          `/api/payments/intents/${intentId}`,
          {
            headers,
            cache: "no-store",
          },
        );
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
            throw new Error(copy.orderExpired);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message !== raw) throw e;
      }
      throw new Error(
        copy.submitTxFailed.replace("{raw}", raw),
      );
    },
    [
      buildAuthedHeaders,
      copy.orderAlreadyPaid,
      copy.orderExpired,
      copy.submitTxFailed,
      loadPaymentSnapshot,
      loadSnapshot,
      reconcileLatestPayment,
    ],
  );

  // ── Auto-reconcile effect ──────────────────────────────
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

  // ── Low-level helpers ──────────────────────────────────
  const waitForReceipt = async (
    txHash: string,
    provider?: EvmProvider,
    timeoutMs = 120000,
    pollMs = 3000,
  ) => {
    const eth = provider || getEvmProvider();
    if (!eth) throw new Error(copy.noWalletProvider);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt =
        await requestWalletWithTimeout<{
          status?: string;
        } | null>(
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
        throw new Error(
          copy.txReverted.replace("{txHash}", txHash),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error(
      copy.txConfirmTimeout.replace("{txHash}", txHash),
    );
  };

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
    if (
      currentChainIdHex.toLowerCase() === targetChainHex.toLowerCase()
    )
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
                  nativeCurrency: {
                    name: "POL",
                    symbol: "POL",
                    decimals: 18,
                  },
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

  // ── pollIntentUntilConfirmed ────────────────────────────
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
        const statusRes = await fetch(
          `/api/payments/intents/${intentId}`,
          {
            method: "GET",
            headers: authHeaders,
            cache: "no-store",
          },
        );
        if (!statusRes.ok) {
          if (statusRes.status >= 500 || statusRes.status === 429) {
            await new Promise((resolve) =>
              setTimeout(resolve, pollMs),
            );
            continue;
          }
          const raw = (await statusRes.text()).slice(0, 260);
          throw new Error(
            copy.queryIntentFailed.replace("{raw}", raw),
          );
        }

        const statusJson =
          (await statusRes.json()) as IntentStatusResponse;
        const intent = statusJson.intent || {};
        const status = String(intent.status || "").toLowerCase();
        const txHash = String(
          intent.tx_hash || txHashHint || "",
        ).toLowerCase();
        if (status === "confirmed") {
          setPaymentError("");
          setPaymentInfo(
            copy.paymentConfirmed.replace(
              "{txHash}",
              shortAddress(txHash),
            ),
          );
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
          throw new Error(
            copy.paymentStatus.replace("{status}", status),
          );
        }
        setPaymentInfo(
          copy.txSubmitted
            .replace("{txHash}", shortTx)
            .replace("{status}", status || "submitted"),
        );
        await new Promise((resolve) =>
          setTimeout(resolve, pollMs),
        );
      }
      throw new Error(copy.paymentPendingTimeout);
    },
    [
      loadPaymentSnapshot,
      loadSnapshot,
      selectedPlan?.plan_code,
    ],
  );

  // ── connectAndBindWallet ────────────────────────────────
  const connectAndBindWallet = async (
    mode: ProviderMode = "auto",
    options: ConnectBindOptions = {},
  ): Promise<boolean> => {
    clearPaymentMessages();
    if (!paymentHostAllowed) {
      setPaymentError(
        copy.paymentHostBlocked.replace(
          "{host}",
          allowedPaymentHosts[0] ||
            "polyweather-pro.vercel.app",
        ),
      );
      return false;
    }
    if (!authIsAuthenticated) {
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
      const binanceBindHint = walletLabel
        .toLowerCase()
        .includes("binance")
        ? copy.binanceBindHint
        : "";

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
        throw new Error(
          isEn
            ? "Wallet account is empty."
            : "钱包账户为空",
        );

      const existingWallet = boundWallets.find(
        (w) =>
          String(w.address || "").toLowerCase() === address,
      );
      if (existingWallet) {
        setWalletAddress(address);
        setSelectedWallet(address);
        setPaymentInfo(
          `${walletLabel} 已绑定: ${shortAddress(address)}。${binanceBindHint || "现在可点击“立即订阅并激活服务”。"}`,
        );
        await Promise.all([
          loadSnapshot(),
          loadPaymentSnapshot(),
        ]);
        if (options.openOverlayAfterBind) setShowOverlay(true);
        setPaymentBusy(false);
        return true;
      }

      setWalletAddress(address);
      const challengeRes = await fetch(
        "/api/payments/wallets/challenge",
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ address }),
        },
      );
      if (!challengeRes.ok) {
        const raw = (await challengeRes.text()).slice(0, 300);
        throw new Error(
          copy.challengeFailed.replace("{raw}", raw),
        );
      }

      const challengeJson = (await challengeRes.json()) as {
        nonce?: string;
        message?: string;
      };
      const message = String(challengeJson.message || "");
      const nonce = String(challengeJson.nonce || "");
      if (!message || !nonce)
        throw new Error(copy.challengeInvalid);

      const signature = await signBindMessage(
        eth,
        address,
        message,
      );
      const verifyRes = await fetch(
        "/api/payments/wallets/verify",
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            address,
            nonce,
            signature,
          }),
        },
      );
      if (!verifyRes.ok) {
        const raw = (await verifyRes.text()).slice(0, 300);
        throw new Error(
          copy.verifyFailedRaw.replace("{raw}", raw),
        );
      }

      setPaymentInfo(
        `${walletLabel} 绑定成功: ${shortAddress(address)}。${binanceBindHint || "现在可点击“立即订阅并激活服务”。"}`,
      );
      setProviderMode(providerSelection.mode);
      if (options.openOverlayAfterBind) setShowOverlay(true);
      await Promise.all([
        loadSnapshot(),
        loadPaymentSnapshot(),
      ]);
      return true;
    } catch (error) {
      setPaymentInfo("");
      setPaymentError(
        normalizePaymentError(error).message,
      );
      return false;
    } finally {
      setPaymentBusy(false);
    }
  };

  // ── handleUnbindWallet ──────────────────────────────────
  const handleUnbindWallet = async (address: string) => {
    const target = String(address || "").toLowerCase();
    if (!target) return;
    if (!authIsAuthenticated) {
      setPaymentError(copy.loginBeforeBind);
      return;
    }
    const confirmed = window.confirm(
      copy.unbindConfirm.replace(
        "{address}",
        shortAddress(target),
      ),
    );
    if (!confirmed) return;

    setPaymentBusy(true);
    clearPaymentMessages();
    try {
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
          detail = String(
            parsed?.detail || parsed?.error || raw,
          );
          if (detail.trim().startsWith("{")) {
            try {
              const nested = JSON.parse(detail);
              detail = String(
                nested?.detail ||
                  nested?.error ||
                  detail,
              );
            } catch {
              // ignore nested parse failure
            }
          }
        } catch {
          // ignore
        }
        throw new Error(
          detail ||
            copy.httpError
              .replace("{status}", String(res.status))
              .replace("{raw}", ""),
        );
      }

      let data: Record<string, unknown> = {};
      try {
        data = raw
          ? (JSON.parse(raw) as Record<string, unknown>)
          : {};
      } catch {
        data = {};
      }
      const newPrimary = String(
        data?.new_primary || "",
      ).toLowerCase();
      const selectedWalletNorm = String(
        selectedWallet || "",
      ).toLowerCase();
      const walletAddressNorm = String(
        walletAddress || "",
      ).toLowerCase();
      if (selectedWalletNorm === target) {
        setSelectedWallet(newPrimary || "");
      }
      if (walletAddressNorm === target) {
        setWalletAddress(newPrimary || "");
      }
      setBoundWallets((prev) =>
        prev.filter(
          (row) =>
            String(row.address || "").toLowerCase() !==
            String(target),
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
      const message = normalizePaymentError(error)
        .message;
      const lower = String(message || "").toLowerCase();
      if (
        lower.includes("unauthorized") ||
        lower.includes("session required") ||
        lower.includes("401")
      ) {
        setPaymentError(
          `${copy.unbindFailed}: ${copy.authExpired}`,
        );
        return;
      }
      setPaymentError(
        `${copy.unbindFailed}: ${message}`,
      );
    } finally {
      setPaymentBusy(false);
    }
  };

  // ── createIntentAndPay ──────────────────────────────────
  const createIntentAndPay = async () => {
    clearPaymentMessages();
    clearPaymentState();
    clearStoredPaymentRecovery();
    if (!paymentHostAllowed) {
      setPaymentError(
        copy.paymentHostBlocked.replace(
          "{host}",
          allowedPaymentHosts[0] ||
            "polyweather-pro.vercel.app",
        ),
      );
      return;
    }
    if (!authIsAuthenticated) {
      setPaymentError(copy.loginBeforePay);
      return;
    }
    if (!paymentConfig?.configured) {
      setPaymentError(copy.payNotReady);
      return;
    }

    const fallbackWallet = String(
      selectedWallet ||
        walletAddress ||
        boundWallets[0]?.address ||
        "",
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
      const activeAccounts =
        await requestWalletWithTimeout<string[]>(
          eth,
          { method: "eth_requestAccounts" },
          "连接付款钱包",
        );
      const activeAddress = String(
        activeAccounts?.[0] || "",
      ).toLowerCase();
      if (!activeAddress)
        throw new Error(
          isEn
            ? "Wallet account is empty."
            : "钱包账户为空",
        );

      const boundAddrSet = new Set(
        boundWallets.map((row) =>
          String(row.address || "").toLowerCase(),
        ),
      );
      if (
        boundAddrSet.size > 0 &&
        !boundAddrSet.has(activeAddress)
      ) {
        throw new Error(
          `当前连接钱包 ${shortAddress(activeAddress)} 未绑定，请先绑定该地址后支付。`,
        );
      }
      const payingWallet = boundAddrSet.has(activeAddress)
        ? activeAddress
        : fallbackWallet;

      setSelectedWallet(payingWallet);
      setProviderMode(providerSelection.mode);

      let accessToken: string;
      try {
        accessToken = await getValidAccessToken();
      } catch (tokenErr) {
        setPaymentError(
          normalizePaymentError(tokenErr).message,
        );
        setPaymentBusy(false);
        return;
      }
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      };

      const latestConfig = await fetchLatestPaymentConfig(
        authHeaders,
        true,
      );
      if (!latestConfig?.enabled || !latestConfig?.configured) {
        throw new Error(copy.payNotReady);
      }
      const expectedReceiver = String(
        latestConfig.receiver_contract || "",
      ).toLowerCase();
      assertExpectedPaymentReceiver(
        expectedReceiver,
        "payment receiver contract",
      );
      if (
        paymentConfig?.receiver_contract &&
        String(paymentConfig.receiver_contract).toLowerCase() !==
          expectedReceiver
      ) {
        setPaymentInfo(
          copy.paymentConfigUpdated.replace(
            "{address}",
            shortAddress(expectedReceiver),
          ),
        );
      } else {
        setPaymentInfo(
          copy.currentReceiver.replace(
            "{address}",
            shortAddress(expectedReceiver),
          ),
        );
      }

      const targetChainId = Number(
        latestConfig.chain_id || 137,
      );
      await ensureTargetChain(eth, targetChainId);

      const createRes = await fetch(
        "/api/payments/intents",
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            plan_code:
              selectedPlan?.plan_code || "pro_monthly",
            payment_mode: "strict",
            allowed_wallet: payingWallet,
            token_address:
              resolvedSelectedTokenAddress || undefined,
            use_points: billing.canRedeem && usePoints,
            points_to_consume:
              billing.canRedeem && usePoints
                ? billing.pointsUsed
                : 0,
            metadata: {
              source: "account_center",
              frontend_host:
                currentPaymentHost || null,
              account_email: backend?.email || null,
            },
          }),
        },
      );
      if (!createRes.ok) {
        const raw = (await createRes.text()).slice(0, 350);
        throw new Error(
          copy.createIntentFailed.replace(
            "{raw}",
            raw,
          ),
        );
      }

      const created =
        (await createRes.json()) as CreatedIntent;
      const intentId = String(
        created.intent?.intent_id || "",
      );
      const txPayload = created.tx_payload;
      if (!intentId || !txPayload?.to || !txPayload?.data)
        throw new Error(copy.intentPayloadInvalid);
      trackAppEvent("checkout_started", {
        entry: "account_center",
        plan_code:
          selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        use_points: billing.canRedeem && usePoints,
        pay_amount_usd: billing.payAmount,
      });
      const intentReceiver = String(
        txPayload.to || "",
      ).toLowerCase();
      if (intentReceiver !== expectedReceiver) {
        throw new Error(
          `payment receiver changed: expected ${expectedReceiver}, got ${intentReceiver}. 请刷新页面后重试。`,
        );
      }
      setLastIntentId(intentId);

      const tokenAddress = String(
        txPayload.token_address || "",
      ).toLowerCase();
      const amountUnits = BigInt(
        String(txPayload.amount_units || "0"),
      );
      if (!tokenAddress.startsWith("0x") || amountUnits <= 0n)
        throw new Error(copy.intentTokenInvalid);
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

      const balanceHex =
        await requestWalletWithTimeout<string>(
          eth,
          {
            method: "eth_call",
            params: [
              {
                to: tokenAddress,
                data: buildBalanceOfCalldata(
                  payingWallet,
                ),
              },
              "latest",
            ],
          },
          `读取 ${tokenSymbol} 余额`,
        );
      const tokenBalance = BigInt(
        String(balanceHex || "0x0"),
      );
      if (tokenBalance < amountUnits) {
        const need = formatTokenUnits(
          amountUnits,
          tokenDecimals,
        );
        const have = formatTokenUnits(
          tokenBalance,
          tokenDecimals,
        );
        throw new Error(
          `支付代币余额不足：需要 ${need} ${tokenSymbol}，当前 ${have} ${tokenSymbol}。请确认你钱包里持有该支付币种。`,
        );
      }

      const allowanceHex =
        await requestWalletWithTimeout<string>(
          eth,
          {
            method: "eth_call",
            params: [
              {
                to: tokenAddress,
                data: buildAllowanceCalldata(
                  payingWallet,
                  txPayload.to,
                ),
              },
              "latest",
            ],
          },
          `读取 ${tokenSymbol} 授权额度`,
        );
      const allowance = BigInt(
        String(allowanceHex || "0x0"),
      );

      if (allowance < amountUnits) {
        setPaymentInfo(
          copy.approvalDetected.replace(
            "{symbol}",
            tokenSymbol,
          ),
        );
        const approveParams: Record<string, any> = {
          from: payingWallet,
          to: tokenAddress,
          data: buildApproveCalldata(
            txPayload.to,
            amountUnits,
          ),
        };
        const approveHash =
          await requestWalletWithTimeout<string>(
            eth,
            {
              method: "eth_sendTransaction",
              params: [approveParams],
            },
            `发起 ${tokenSymbol} 授权`,
            WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
          );
        await waitForReceipt(
          String(approveHash || ""),
          eth,
        );
        approvedInThisRun = true;
        setPaymentInfo(
          copy.approvalDone.replace(
            "{symbol}",
            tokenSymbol,
          ),
        );
      } else {
        setPaymentInfo(copy.approvalSufficient);
      }

      const payParams: Record<string, any> = {
        from: payingWallet,
        to: txPayload.to,
        data: txPayload.data,
      };
      if (
        txPayload.value &&
        txPayload.value !== "0x0" &&
        txPayload.value !== "0"
      ) {
        payParams.value = txPayload.value;
      }

      const txHash =
        await requestWalletWithTimeout<string>(
          eth,
          {
            method: "eth_sendTransaction",
            params: [payParams],
          },
          "发起支付交易",
          WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
        );
      const txHashNorm = String(
        txHash || "",
      ).toLowerCase();
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
        const raw = (await submitRes.text()).slice(
          0,
          350,
        );
        if (submitRes.status === 409) {
          await handleSubmit409(
            intentId,
            txHashNorm,
            raw,
          );
          return;
        }
        throw new Error(
          copy.submitTxFailed.replace(
            "{raw}",
            raw,
          ),
        );
      }

      const confirmRes = await fetch(
        `/api/payments/intents/${intentId}/confirm`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            tx_hash: txHashNorm,
          }),
        },
      );
      if (!confirmRes.ok) {
        const raw = (await confirmRes.text()).slice(
          0,
          350,
        );
        const lowerRaw = raw.toLowerCase();
        const maybePending =
          (confirmRes.status === 404 &&
            !lowerRaw.includes(
              "payment intent not found",
            )) ||
          confirmRes.status === 408 ||
          (confirmRes.status === 409 &&
            (lowerRaw.includes(
              "confirmations not enough",
            ) ||
              lowerRaw.includes(
                "tx indexed partially",
              )));
        if (maybePending) {
          setPaymentInfo(
            `交易已提交: ${shortAddress(txHashNorm)}，等待链上确认中...`,
          );
          await pollIntentUntilConfirmed(
            intentId,
            authHeaders,
            txHashNorm,
          );
          return;
        }
        throw new Error(
          copy.confirmFailed.replace("{raw}", raw),
        );
      }

      setPaymentInfo(
        copy.paymentConfirmed.replace(
          "{txHash}",
          shortAddress(txHashNorm),
        ),
      );
      trackAppEvent("checkout_succeeded", {
        entry: "account_center",
        plan_code:
          selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        tx_hash: txHashNorm,
      });
      await loadSnapshot();
      await loadPaymentSnapshot();
    } catch (error) {
      const normalized =
        normalizePaymentError(error);
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

  // ── createManualPaymentIntent ────────────────────────────
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
          allowedPaymentHosts[0] ||
            "polyweather-pro.vercel.app",
        ),
      );
      return;
    }
    if (!authIsAuthenticated) {
      setPaymentError(copy.loginBeforePay);
      return;
    }
    if (!paymentConfig?.configured) {
      setPaymentError(copy.payNotReady);
      return;
    }

    setPaymentBusy(true);
    try {
      const authHeaders = await buildAuthedHeaders(
        true,
        false,
      );
      const createRes = await fetch(
        "/api/payments/intents",
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            plan_code:
              selectedPlan?.plan_code || "pro_monthly",
            payment_mode: "direct",
            token_address:
              resolvedSelectedTokenAddress ||
              undefined,
            use_points: billing.canRedeem && usePoints,
            points_to_consume:
              billing.canRedeem && usePoints
                ? billing.pointsUsed
                : 0,
            metadata: {
              source:
                "account_center_manual_transfer",
              frontend_host:
                currentPaymentHost || null,
              account_email: backend?.email || null,
            },
          }),
        },
      );
      if (!createRes.ok) {
        const raw = (await createRes.text()).slice(
          0,
          350,
        );
        throw new Error(
          copy.createManualIntentFailed.replace(
            "{raw}",
            raw,
          ),
        );
      }
      const created =
        (await createRes.json()) as CreatedIntent;
      const direct = created.direct_payment;
      const intentId = String(
        created.intent?.intent_id ||
          direct?.intent_id ||
          "",
      );
      if (
        !intentId ||
        !direct?.receiver_address ||
        !direct?.amount_usdc
      ) {
        throw new Error(copy.manualPaymentInvalid);
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
        plan_code:
          selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        payment_mode: "direct",
        use_points: billing.canRedeem && usePoints,
        pay_amount_usd: billing.payAmount,
      });
    } catch (error) {
      setPaymentError(
        normalizePaymentError(error).message,
      );
    } finally {
      setPaymentBusy(false);
    }
  };

  // ── submitManualPaymentTx ──────────────────────────────
  const submitManualPaymentTx = async () => {
    const txHashNorm = String(manualTxHash || "")
      .trim()
      .toLowerCase();
    const intentId = String(
      lastIntentId || manualPayment?.intent_id || "",
    ).trim();
    if (!intentId || !manualPayment) {
      setPaymentError(copy.manualOrderRequired);
      return;
    }
    if (
      !txHashNorm.startsWith("0x") ||
      txHashNorm.length !== 66
    ) {
      setPaymentError(copy.txHashRequired);
      return;
    }
    setPaymentBusy(true);
    setPaymentError("");
    try {
      const authHeaders = await buildAuthedHeaders(
        true,
        false,
      );
      const submitRes = await fetch(
        `/api/payments/intents/${intentId}/submit`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            tx_hash: txHashNorm,
          }),
        },
      );
      if (!submitRes.ok) {
        const raw = (await submitRes.text()).slice(
          0,
          350,
        );
        if (submitRes.status === 409) {
          await handleSubmit409(
            intentId,
            txHashNorm,
            raw,
          );
          return;
        }
        throw new Error(
          copy.submitTxFailed.replace(
            "{raw}",
            raw,
          ),
        );
      }
      const confirmRes = await fetch(
        `/api/payments/intents/${intentId}/confirm`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            tx_hash: txHashNorm,
          }),
        },
      );
      if (!confirmRes.ok) {
        const raw = (await confirmRes.text()).slice(
          0,
          350,
        );
        const lowerRaw = raw.toLowerCase();
        const maybePending =
          confirmRes.status === 408 ||
          (confirmRes.status === 409 &&
            (lowerRaw.includes(
              "confirmations not enough",
            ) ||
              lowerRaw.includes(
                "tx indexed partially",
              )));
        if (maybePending) {
          setPaymentInfo(
            `交易已提交: ${shortAddress(txHashNorm)}，等待链上确认中...`,
          );
          await pollIntentUntilConfirmed(
            intentId,
            authHeaders,
            txHashNorm,
          );
          return;
        }
        throw new Error(
          copy.confirmFailed.replace(
            "{raw}",
            raw,
          ),
        );
      }
      setLastTxHash(txHashNorm);
      setPaymentInfo(
        copy.paymentConfirmed.replace(
          "{txHash}",
          shortAddress(txHashNorm),
        ),
      );
      setManualPayment(null);
      setManualTxHash("");
      setTxValidation({
        loading: false,
        checked: false,
      });
      trackAppEvent("checkout_succeeded", {
        entry:
          "account_center_manual_transfer",
        plan_code:
          selectedPlan?.plan_code ||
          "pro_monthly",
        intent_id: intentId,
        tx_hash: txHashNorm,
      });
      await loadSnapshot();
      await loadPaymentSnapshot();
    } catch (error) {
      setPaymentError(
        normalizePaymentError(error).message,
      );
    } finally {
      setPaymentBusy(false);
    }
  };

  // ── validateTxHash ────────────────────────────────────
  const validateTxHash = useCallback(
    async (intentId: string, hash: string) => {
      const hashNorm = String(hash || "")
        .trim()
        .toLowerCase();
      if (
        !hashNorm.startsWith("0x") ||
        hashNorm.length !== 66
      ) {
        setTxValidation({
          loading: false,
          checked: false,
        });
        return;
      }
      setTxValidation({
        loading: true,
        checked: false,
      });
      try {
        const headers = await buildAuthedHeaders(
          true,
          false,
        );
        const res = await fetch(
          `/api/payments/intents/${intentId}/validate`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              tx_hash: hashNorm,
            }),
          },
        );
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
        setTxValidation({
          loading: false,
          checked: false,
        });
      }
    },
    [buildAuthedHeaders],
  );

  // ── handleOverlayCheckout ──────────────────────────────
  const handleOverlayCheckout = async () => {
    if (!paymentHostAllowed) {
      setPaymentError(
        copy.paymentHostBlocked.replace(
          "{host}",
          allowedPaymentHosts[0] ||
            "polyweather-pro.vercel.app",
        ),
      );
      return;
    }
    if (!authIsAuthenticated) {
      setPaymentError(copy.loginBeforePay);
      return;
    }
    if (!hasPayingWallet) {
      setPaymentInfo(copy.openBindFlow);
      const bound = await connectAndBindWallet(
        providerMode,
        { openOverlayAfterBind: true },
      );
      if (!bound) return;
      setPaymentInfo(copy.walletBoundCreatingOrder);
      await createIntentAndPay();
      return;
    }
    await createIntentAndPay();
  };

  // ── openTelegramBotBindLink ──────────────────────────────
  const openTelegramBotBindLink = async () => {
    setTelegramBindOpening(true);
    setPaymentError("");
    setTelegramBindUrl("");
    const popup = window.open(
      "about:blank",
      "_blank",
      "noopener,noreferrer",
    );
    try {
      const authHeaders = await buildAuthedHeaders(
        true,
        false,
      );
      const res = await fetch(
        "/api/auth/telegram/bot-bind-link",
        {
          method: "POST",
          headers: authHeaders,
        },
      );
      if (!res.ok) {
        const raw = (await res.text()).slice(0, 300);
        throw new Error(
          raw || copy.telegramBindFailed,
        );
      }
      const data = (await res.json()) as {
        bot_url?: string;
      };
      const botUrl = String(data.bot_url || "").trim();
      if (!botUrl)
        throw new Error(copy.telegramBindLinkMissing);
      if (popup && !popup.closed) {
        popup.location.href = botUrl;
        setPaymentInfo(copy.telegramBindClickHint);
      } else {
        setPaymentInfo(copy.telegramPopupBlocked);
        setTelegramBindUrl(botUrl);
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      setPaymentError(
        normalizePaymentError(error).message,
      );
    } finally {
      setTelegramBindOpening(false);
    }
  };

  // ── bind_token URL effect ──────────────────────────────
  useEffect(() => {
    if (!authIsAuthenticated) return;
    const params = new URLSearchParams(
      window.location.search,
    );
    const token = params.get("bind_token");
    if (!token) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("bind_token");
    window.history.replaceState(
      null,
      "",
      url.toString(),
    );
    (async () => {
      setPaymentError("");
      setPaymentInfo("");
      try {
        const authHeaders = await buildAuthedHeaders(
          true,
          false,
        );
        const res = await fetch(
          "/api/auth/telegram/bind-by-token",
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ token }),
          },
        );
        if (!res.ok) {
          const raw = (await res.text()).slice(
            0,
            350,
          );
          throw new Error(
            copy.bindFailed.replace("{raw}", raw),
          );
        }
        const data = (await res.json()) as {
          telegram_pricing?: TelegramPricing | null;
        };
        if (
          data.telegram_pricing?.is_group_member
        ) {
          const amount =
            data.telegram_pricing.amount_usdc ||
            "10";
          setPaymentInfo(
            copy.telegramVerifySuccess.replace(
              "{amount}",
              amount,
            ),
          );
        }
        await loadSnapshot();
        await loadPaymentSnapshot();
      } catch (error) {
        setPaymentError(
          normalizePaymentError(error).message,
        );
      }
    })();
  }, [
    authIsAuthenticated,
    buildAuthedHeaders,
    loadPaymentSnapshot,
    loadSnapshot,
  ]);

  // ==========================================================
  return {
    // State from usePaymentState
    paymentBusy,
    paymentInfo,
    paymentError,
    lastIntentId,
    lastTxHash,
    lastPaymentStartedAt,
    telegramBindOpening,
    telegramBindUrl,
    manualPayment,
    manualTxHash,
    txValidation,
    paymentMethodTab,
    clearPaymentMessages,
    clearPaymentState,

    // Setters from usePaymentState (needed by component render)
    setPaymentBusy,
    setPaymentInfo,
    setPaymentError,
    setLastIntentId,
    setLastTxHash,
    setLastPaymentStartedAt,
    setTelegramBindOpening,
    setPaymentMethodTab,
    setManualPayment,
    setManualTxHash,
    setTxValidation,

    // Additional state
    paymentConfig,
    boundWallets,
    walletAddress,
    selectedPlanCode,
    selectedTokenAddress,
    selectedWallet,
    providerMode,
    injectedProviderOptions,
    selectedInjectedProviderKey,
    reconcileBusy,

    // Setters for shared state
    setSelectedTokenAddress,
    setSelectedWallet,
    setSelectedInjectedProviderKey,
    setProviderMode,

    // Derived values
    authUserId,
    authIsAuthenticated,
    paymentReadyForRecovery,
    hasRecentPaymentRecovery,
    allowedPaymentHosts,
    currentPaymentHost,
    paymentHostAllowed,
    selectedPlan,
    selectedPaymentToken,
    selectedTokenLabel,
    availableTokenList,
    effectivePlanList,
    resolvedSelectedTokenAddress,
    paymentReceiverAddress,
    paymentWalletLabel,
    hasPayingWallet,
    totalPoints,
    billing,

    // Callbacks
    loadSnapshot,
    loadPaymentSnapshot,
    connectAndBindWallet,
    handleUnbindWallet,
    createIntentAndPay,
    createManualPaymentIntent,
    submitManualPaymentTx,
    validateTxHash,
    handleOverlayCheckout,
    openTelegramBotBindLink,
  };
}
