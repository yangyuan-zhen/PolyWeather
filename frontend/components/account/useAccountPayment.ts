"use client";

import { useCallback, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import type {
  AuthMeResponse,
  BoundWallet,
  PaymentConfig,
  ProviderMode,
  InjectedProviderOption,
} from "./types";
import { usePaymentState } from "./usePaymentState";
import { useWalletBind } from "./useWalletBind";
import { usePaymentFlow } from "./usePaymentFlow";
import { useBilling } from "./useBilling";

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

  // ── Derived values ──────────────────────────────────────
  const authUserId = backend?.user_id || user?.id || "";
  const authIsAuthenticated = Boolean(authUserId);

  // ── getValidAccessToken ──────────────────────────────────
  const getValidAccessToken = useCallback(async (): Promise<string> => {
    if (!supabaseReady)
      throw new Error(
        isEn
          ? "Supabase is not configured. Unable to get auth token."
          : "Supabase 未配置，无法获取登录凭证。",
      );
    const client = getSupabaseBrowserClient();
    const { data: { session: cached } } = await client.auth.getSession();
    const cachedToken = String(cached?.access_token || "").trim();
    const expiresAtSec = Number(cached?.expires_at || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    const refreshLeadSec = 90;
    if (cachedToken && Number.isFinite(expiresAtSec) && expiresAtSec > nowSec + refreshLeadSec) {
      return cachedToken;
    }
    if (cachedToken && (!Number.isFinite(expiresAtSec) || expiresAtSec <= 0)) {
      return cachedToken;
    }
    const { data: { session: refreshed }, error } = await client.auth.refreshSession();
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

  // ── buildAuthedHeaders ──────────────────────────────────
  const buildAuthedHeaders = useCallback(
    async (withJson = false, requireAuth = false): Promise<Record<string, string>> => {
      const headers: Record<string, string> = {};
      if (withJson) headers["Content-Type"] = "application/json";
      if (!supabaseReady) return headers;
      try {
        const token = await getValidAccessToken();
        headers.Authorization = `Bearer ${token}`;
      } catch (error) {
        if (requireAuth) throw error;
        try {
          const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
          const fallbackToken = String(session?.access_token || "").trim();
          if (fallbackToken) headers.Authorization = `Bearer ${fallbackToken}`;
        } catch {
          // Non-authenticated page load — silently skip.
        }
      }
      return headers;
    },
    [supabaseReady, getValidAccessToken],
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
        fetch("/api/auth/me", { cache: "no-store", headers }),
      );
      const [userResult, backendResult] = await Promise.all([userPromise, backendPromise]);
      setUser(userResult.data?.user ?? null);
      if (!backendResult.ok) {
        if (retry && backendResult.status === 401) {
          await new Promise((r) => setTimeout(r, 1200));
          return attempt(false);
        }
        const raw = (await backendResult.text()).slice(0, 260);
        throw new Error(copy.httpError.replace("{status}", String(backendResult.status)).replace("{raw}", raw));
      }
      let backendJson = (await backendResult.json()) as AuthMeResponse;
      if (
        retry &&
        supabaseReady &&
        userResult.data?.user &&
        backendJson.authenticated === false
      ) {
        try {
          const {
            data: { session: refreshedSession },
          } = await getSupabaseBrowserClient().auth.refreshSession();
          const refreshedToken = String(
            refreshedSession?.access_token || "",
          ).trim();
          if (refreshedToken) {
            const retriedBackendResult = await fetch("/api/auth/me", {
              cache: "no-store",
              headers: { Authorization: `Bearer ${refreshedToken}` },
            });
            if (retriedBackendResult.ok) {
              const retriedBackendJson =
                (await retriedBackendResult.json()) as AuthMeResponse;
              backendJson = retriedBackendJson;
            }
          }
        } catch {
          // Keep the first response; the UI treats a logged-in local user with
          // an unauthenticated backend snapshot as a temporary sync state.
        }
      }
      setBackend(backendJson);
      setUpdatedAt(new Date().toISOString());
    };
    try { await attempt(true); }
    catch (error) { setErrorText(String(error)); }
  }, [buildAuthedHeaders, supabaseReady, copy.httpError]);

  // ── Shared state for sub-hooks ───────────────────────────
  // These state variables are managed in the master hook and passed
  // to the relevant sub-hooks. loadPaymentSnapshot crosses domains.
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [boundWallets, setBoundWallets] = useState<BoundWallet[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [selectedPlanCode, setSelectedPlanCode] = useState("pro_monthly");
  const [selectedPaymentChainId, setSelectedPaymentChainId] = useState<number | null>(null);
  const [selectedTokenAddress, setSelectedTokenAddress] = useState("");
  const [selectedWallet, setSelectedWallet] = useState("");
  const [providerMode, setProviderMode] = useState<ProviderMode>("auto");
  const [injectedProviderOptions, setInjectedProviderOptions] = useState<InjectedProviderOption[]>([]);
  const [selectedInjectedProviderKey, setSelectedInjectedProviderKey] = useState("");

  // ── Chain ID derived from payment config ────────────────
  const chainId = selectedPaymentChainId || paymentConfig?.default_chain_id || paymentConfig?.chain_id || 137;

  // ── loadPaymentSnapshot ──────────────────────────────────
  // Defined in master because it sets state across multiple sub-hook domains.
  const loadPaymentSnapshotImpl = useCallback(async () => {
    if (!backend?.authenticated) {
      setPaymentConfig(null);
      setBoundWallets([]);
      return;
    }
    try {
      const authHeadersPromise = buildAuthedHeaders(false);
      const [configRes, walletsRes] = await Promise.all([
        authHeadersPromise.then((headers) => fetch("/api/payments/config", { cache: "no-store", headers })),
        authHeadersPromise.then((headers) => fetch("/api/payments/wallets", { cache: "no-store", headers })),
      ]);
      if (configRes.ok) {
        const configJson = (await configRes.json()) as PaymentConfig;
        setPaymentConfig(configJson);
        if (!selectedPlanCode && configJson.plans?.length) {
          setSelectedPlanCode(configJson.plans[0].plan_code);
        }
        const tokenOptions = Array.isArray(configJson.tokens)
          ? configJson.tokens.filter((row) => typeof row?.address === "string" && String(row.address).startsWith("0x"))
          : [];
        const chainOptions = Array.isArray(configJson.chains)
          ? configJson.chains.filter((row) => Number(row?.chain_id) > 0)
          : [];
        const defaultChainId = Number(
          configJson.default_chain_id ||
            chainOptions.find((row) => row.is_default)?.chain_id ||
            configJson.chain_id ||
            tokenOptions.find((row) => row.is_default)?.chain_id ||
            137,
        );
        const supportedChainIds = new Set(
          (chainOptions.length ? chainOptions : [{ chain_id: defaultChainId }])
            .map((row) => Number(row.chain_id))
            .filter((value) => Number.isFinite(value) && value > 0),
        );
        setSelectedPaymentChainId((prev) =>
          prev && supportedChainIds.has(prev) ? prev : defaultChainId,
        );
        const activeChainId =
          selectedPaymentChainId && supportedChainIds.has(selectedPaymentChainId)
            ? selectedPaymentChainId
            : defaultChainId;
        const tokenOptionsForChain = tokenOptions.filter(
          (row) => Number(row.chain_id || activeChainId) === activeChainId,
        );
        const defaultTokenAddress = String(
          configJson.default_token_address ||
            tokenOptionsForChain.find((row) => row.is_default)?.address ||
            tokenOptionsForChain[0]?.address ||
            tokenOptions.find((row) => row.is_default)?.address ||
            tokenOptions[0]?.address ||
            configJson.token_address || "",
        ).toLowerCase();
        if (defaultTokenAddress) {
          setSelectedTokenAddress((prev: string) => prev || defaultTokenAddress);
        }
      }
      if (walletsRes.ok) {
        const walletsJson = (await walletsRes.json()) as { wallets?: BoundWallet[] };
        const wallets = (Array.isArray(walletsJson.wallets) ? walletsJson.wallets : [])
          .filter((row) => {
            const status = String(row?.status || "active").toLowerCase();
            const address = String(row?.address || "");
            return status === "active" && address.startsWith("0x");
          })
          .map((row) => ({ ...row, address: String(row.address || "").toLowerCase() }));
        setBoundWallets(wallets);
        if (wallets.length) {
          const currentSelected = String(selectedWallet || "").toLowerCase();
          const hasCurrent = wallets.some((row) => String(row.address || "").toLowerCase() === currentSelected);
          const fallback = wallets.find((row) => Boolean(row.is_primary))?.address || wallets[0].address;
          if (!currentSelected || !hasCurrent) setSelectedWallet(fallback);
          const currentWalletAddress = String(walletAddress || "").toLowerCase();
          const hasWalletAddress = wallets.some((row) => String(row.address || "").toLowerCase() === currentWalletAddress);
          if (!currentWalletAddress || !hasWalletAddress) setWalletAddress(fallback);
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
    selectedPaymentChainId,
    selectedWallet,
    walletAddress,
  ]);

  // ── Selected plan (derived, shared across sub-hooks) ───
  const monthlyPlanList = (paymentConfig?.plans || []).filter(
    (p) => String(p.plan_code || "").trim().toLowerCase() === "pro_monthly",
  );
  const effectivePlanList = monthlyPlanList.length ? monthlyPlanList : (paymentConfig?.plans || []);
  const selectedPlan = effectivePlanList.find((p) => p.plan_code === selectedPlanCode) || effectivePlanList[0];

  // ── useWalletBind ──────────────────────────────────────
  const walletBind = useWalletBind({
    isEn,
    walletConnectEnabled,
    copy,
    chainId,
    boundWallets,
    setBoundWallets,
    walletAddress,
    setWalletAddress,
    selectedWallet,
    setSelectedWallet,
    providerMode,
    setProviderMode,
    injectedProviderOptions,
    setInjectedProviderOptions,
    selectedInjectedProviderKey,
    setSelectedInjectedProviderKey,
    setPaymentBusy,
    setPaymentInfo,
    setPaymentError,
    setShowOverlay,
    clearPaymentMessages,
    authIsAuthenticated,
    getValidAccessToken,
    buildAuthedHeaders,
    loadSnapshot,
    loadPaymentSnapshot: loadPaymentSnapshotImpl,
  });

  // Ref to break circular dependency: usePaymentFlow needs connectAndBindWallet from useWalletBind
  const connectAndBindWalletRef = useRef(walletBind.connectAndBindWallet);
  connectAndBindWalletRef.current = walletBind.connectAndBindWallet;

  // ── useBilling ──────────────────────────────────────────
  const billing = useBilling({
    isEn,
    copy,
    backend,
    supabaseReady,
    paymentConfig,
    authUserId,
    authIsAuthenticated,
    usePoints,
    setUsePoints,
    lastIntentId,
    lastTxHash,
    lastPaymentStartedAt,
    setLastIntentId,
    setLastTxHash,
    setLastPaymentStartedAt,
    setPaymentBusy,
    setPaymentInfo,
    setPaymentError,
    setTelegramBindOpening,
    clearPaymentState,
    selectedPlan,
    getValidAccessToken,
    buildAuthedHeaders,
    loadSnapshot,
    loadPaymentSnapshot: loadPaymentSnapshotImpl,
    user,
  });

  // Ref to break circular dependency: usePaymentFlow needs handleSubmit409 from useBilling
  const handleSubmit409Ref = useRef(billing.handleSubmit409);
  handleSubmit409Ref.current = billing.handleSubmit409;

  // ── usePaymentFlow ──────────────────────────────────────
  const paymentFlow = usePaymentFlow({
    isEn,
    copy,
    backend,
    paymentConfig,
    setPaymentConfig,
    selectedPlanCode,
    setSelectedPlanCode,
    selectedPaymentChainId: chainId,
    setSelectedPaymentChainId,
    selectedTokenAddress,
    setSelectedTokenAddress,
    boundWallets,
    selectedWallet,
    walletAddress,
    providerMode,
    selectedInjectedProviderKey,
    manualTxHash,
    manualPayment,
    lastIntentId,
    setPaymentBusy,
    setPaymentInfo,
    setPaymentError,
    setLastIntentId,
    setLastTxHash,
    setLastPaymentStartedAt,
    setShowOverlay,
    setManualPayment,
    setManualTxHash,
    setTxValidation,
    setPaymentMethodTab,
    clearPaymentMessages,
    clearPaymentState,
    setSelectedWallet,
    setProviderMode,
    selectedPlan,
    billing: billing.billing,
    usePoints,
    currentPaymentHost: billing.currentPaymentHost,
    paymentHostAllowed: billing.paymentHostAllowed,
    allowedPaymentHosts: billing.allowedPaymentHosts,
    authIsAuthenticated,
    hasPayingWallet: walletBind.hasPayingWallet,
    getValidAccessToken,
    buildAuthedHeaders,
    loadSnapshot,
    loadPaymentSnapshot: loadPaymentSnapshotImpl,
    waitForReceipt: walletBind.waitForReceipt,
    ensureTargetChain: walletBind.ensureTargetChain,
    resolvePaymentProvider: walletBind.resolvePaymentProvider,
    connectAndBindWalletRef,
    handleSubmit409Ref,
  });

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
    telegramBindUrl: billing.telegramBindUrl,
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
    selectedPaymentChainId: chainId,
    selectedTokenAddress,
    selectedWallet,
    providerMode,
    injectedProviderOptions,
    selectedInjectedProviderKey,
    reconcileBusy: billing.reconcileBusy,

    // Setters for shared state
    setSelectedTokenAddress,
    setSelectedPaymentChainId,
    setSelectedWallet,
    setSelectedInjectedProviderKey,
    setProviderMode,

    // Derived values
    authUserId,
    authIsAuthenticated,
    paymentReadyForRecovery: billing.paymentReadyForRecovery,
    hasRecentPaymentRecovery: billing.hasRecentPaymentRecovery,
    allowedPaymentHosts: billing.allowedPaymentHosts,
    currentPaymentHost: billing.currentPaymentHost,
    paymentHostAllowed: billing.paymentHostAllowed,
    selectedPlan,
    selectedPaymentToken: paymentFlow.selectedPaymentToken,
    selectedTokenLabel: paymentFlow.selectedTokenLabel,
    availableTokenList: paymentFlow.availableTokenList,
    availableChainList: paymentFlow.availableChainList,
    selectedPaymentChain: paymentFlow.selectedPaymentChain,
    effectivePlanList,
    resolvedSelectedTokenAddress: paymentFlow.resolvedSelectedTokenAddress,
    paymentReceiverAddress: paymentFlow.paymentReceiverAddress,
    paymentWalletLabel: walletBind.paymentWalletLabel,
    hasPayingWallet: walletBind.hasPayingWallet,
    totalPoints: billing.totalPoints,
    billing: billing.billing,

    // Callbacks
    loadSnapshot,
    loadPaymentSnapshot: loadPaymentSnapshotImpl,
    connectAndBindWallet: walletBind.connectAndBindWallet,
    handleUnbindWallet: walletBind.handleUnbindWallet,
    createIntentAndPay: paymentFlow.createIntentAndPay,
    createManualPaymentIntent: paymentFlow.createManualPaymentIntent,
    submitManualPaymentTx: paymentFlow.submitManualPaymentTx,
    validateTxHash: paymentFlow.validateTxHash,
    handleOverlayCheckout: paymentFlow.handleOverlayCheckout,
    openTelegramBotBindLink: billing.openTelegramBotBindLink,
  };
}
