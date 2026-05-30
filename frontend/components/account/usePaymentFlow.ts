"use client";

import { useCallback, useMemo } from "react";
import type {
  AuthMeResponse,
  BoundWallet,
  ConnectBindOptions,
  CreatedIntent,
  EvmProvider,
  IntentStatusResponse,
  PaymentChainOption,
  PaymentConfig,
  PaymentTokenOption,
  ProviderMode,
  ProviderSelection,
} from "./types";
import {
  WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
} from "./constants";
import { chainIdToDisplayName, clearStoredPaymentRecovery, shortAddress } from "./formatters";
import {
  buildAllowanceCalldata,
  buildApproveCalldata,
  buildBalanceOfCalldata,
  formatTokenUnits,
  normalizePaymentError,
  requestWalletWithTimeout,
} from "./payment-utils";
import { trackAppEvent } from "@/lib/app-analytics";
import {
  assertExpectedPaymentReceiver,
  EXPECTED_PAYMENT_RECEIVER_ADDRESS,
} from "@/lib/payment-receiver";
import type { PaymentTxValidationState } from "./usePaymentState";

// ============================================================
export interface UsePaymentFlowParams {
  isEn: boolean;
  copy: Record<string, string>;
  backend: AuthMeResponse | null;

  // Shared payment config state
  paymentConfig: PaymentConfig | null;
  setPaymentConfig: React.Dispatch<React.SetStateAction<PaymentConfig | null>>;
  selectedPlanCode: string;
  setSelectedPlanCode: React.Dispatch<React.SetStateAction<string>>;
  selectedPaymentChainId: number;
  setSelectedPaymentChainId: React.Dispatch<React.SetStateAction<number | null>>;
  selectedTokenAddress: string;
  setSelectedTokenAddress: React.Dispatch<React.SetStateAction<string>>;

  // Shared wallet state (read-only)
  boundWallets: BoundWallet[];
  selectedWallet: string;
  walletAddress: string;
  providerMode: ProviderMode;
  selectedInjectedProviderKey: string;

  // Payment UI state + setters
  manualTxHash: string;
  manualPayment: CreatedIntent["direct_payment"] | null;
  lastIntentId: string;
  setPaymentBusy: (v: boolean) => void;
  setPaymentInfo: (v: string) => void;
  setPaymentError: (v: string) => void;
  setLastIntentId: (v: string) => void;
  setLastTxHash: (v: string) => void;
  setLastPaymentStartedAt: (v: number) => void;
  setShowOverlay: (v: boolean) => void;
  setManualPayment: (v: CreatedIntent["direct_payment"] | null) => void;
  setManualTxHash: (v: string) => void;
  setTxValidation: (v: PaymentTxValidationState) => void;
  setPaymentMethodTab: (v: "wallet" | "manual") => void;
  clearPaymentMessages: () => void;
  clearPaymentState: () => void;

  // Setters for shared state
  setSelectedWallet: React.Dispatch<React.SetStateAction<string>>;
  setProviderMode: React.Dispatch<React.SetStateAction<ProviderMode>>;

  // Derived values from master
  selectedPlan?: { plan_code?: string; amount_usdc?: string };
  billing: {
    planAmount: number;
    pointsEnabled: boolean;
    pointsPerUsdc: number;
    maxDiscountUsdc: number;
    pointsUsed: number;
    discountAmount: number;
    payAmount: number;
    canRedeem: boolean;
  };
  usePoints: boolean;
  currentPaymentHost: string;
  paymentHostAllowed: boolean;
  allowedPaymentHosts: string[];
  authIsAuthenticated: boolean;
  hasPayingWallet: boolean;

  // Callbacks from master
  getValidAccessToken: () => Promise<string>;
  buildAuthedHeaders: (withJson?: boolean, requireAuth?: boolean) => Promise<Record<string, string>>;
  loadSnapshot: () => Promise<void>;
  refreshEntitlementAfterPayment: () => Promise<void>;
  loadPaymentSnapshot: () => Promise<void>;
  waitForReceipt: (txHash: string, provider?: EvmProvider, timeoutMs?: number, pollMs?: number) => Promise<any>;
  ensureTargetChain: (eth: EvmProvider, targetChainId: number, chain?: PaymentChainOption) => Promise<void>;

  // Ref-wrapped cross-hook callbacks
  connectAndBindWalletRef: React.MutableRefObject<((mode?: ProviderMode, options?: ConnectBindOptions) => Promise<boolean>) | null>;
  handleSubmit409Ref: React.MutableRefObject<((intentId: string, txHashNorm: string, raw: string) => Promise<void>) | null>;

  // Wallet provider helpers
  resolvePaymentProvider: (mode?: ProviderMode, preferredInjectedKey?: string) => Promise<ProviderSelection>;
}

// ============================================================
export function usePaymentFlow(params: UsePaymentFlowParams) {
  const {
    isEn,
    copy,
    backend,
    paymentConfig,
    setPaymentConfig,
    selectedPlanCode,
    setSelectedPlanCode,
    selectedPaymentChainId,
    setSelectedPaymentChainId,
    selectedTokenAddress,
    setSelectedTokenAddress,
    boundWallets,
    selectedWallet,
    walletAddress,
    providerMode,
    selectedInjectedProviderKey,
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
    manualTxHash,
    manualPayment,
    lastIntentId,
    setPaymentMethodTab,
    clearPaymentMessages,
    clearPaymentState,
    setSelectedWallet,
    setProviderMode,
    billing,
    usePoints,
    currentPaymentHost,
    paymentHostAllowed,
    allowedPaymentHosts,
    authIsAuthenticated,
    hasPayingWallet,
    getValidAccessToken,
    buildAuthedHeaders,
    loadSnapshot,
    refreshEntitlementAfterPayment,
    loadPaymentSnapshot,
    waitForReceipt,
    ensureTargetChain,
    connectAndBindWalletRef,
    handleSubmit409Ref,
    resolvePaymentProvider,
  } = params;

  // ── Derived payment values ──────────────────────────────
  const planList = paymentConfig?.plans || [];
  const effectivePlanList = planList;
  const selectedPlan = effectivePlanList.find((plan) => plan.plan_code === selectedPlanCode) || effectivePlanList[0];
  const trackPaymentStart = useCallback((payload: Record<string, unknown>) => {
    trackAppEvent("checkout_started", payload);
    trackAppEvent("payment_start", payload);
  }, []);
  const trackPaymentSuccess = useCallback((payload: Record<string, unknown>) => {
    trackAppEvent("checkout_succeeded", payload);
    trackAppEvent("payment_success", payload);
  }, []);

  const verifyPaymentAuthReady = useCallback(async () => {
    const accessToken = await getValidAccessToken();
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    const authRes = await fetch("/api/auth/me", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!authRes.ok) {
      const raw = (await authRes.text().catch(() => "")).slice(0, 240);
      throw new Error(
        isEn
          ? `Authentication check failed before payment (${authRes.status}). ${raw}`
          : `支付前登录态校验失败 (${authRes.status})。${raw}`,
      );
    }
    const profile = (await authRes.json()) as AuthMeResponse;
    if (profile.authenticated !== true) {
      throw new Error(copy.loginBeforePay);
    }
    return {
      authHeaders,
      auth_confirmed_at: new Date().toISOString(),
      profile,
    };
  }, [copy.loginBeforePay, getValidAccessToken, isEn]);

  const availableChainList: PaymentChainOption[] = useMemo(() => {
    const configured = Array.isArray(paymentConfig?.chains) ? paymentConfig?.chains || [] : [];
    const clean = configured
      .map((row) => ({
        ...row,
        chain_id: Number(row.chain_id),
        name: String(row.name || chainIdToDisplayName(Number(row.chain_id))),
      }))
      .filter((row) => Number.isFinite(row.chain_id) && row.chain_id > 0);
    if (clean.length) return clean;
    const chainIds = new Set<number>();
    const defaultChainId = Number(paymentConfig?.default_chain_id || paymentConfig?.chain_id || 137);
    if (Number.isFinite(defaultChainId) && defaultChainId > 0) chainIds.add(defaultChainId);
    (paymentConfig?.tokens || []).forEach((token) => {
      const chainId = Number(token.chain_id || defaultChainId);
      if (Number.isFinite(chainId) && chainId > 0) chainIds.add(chainId);
    });
    return Array.from(chainIds).sort((a, b) => a - b).map((chainId) => ({
      chain_id: chainId,
      name: chainIdToDisplayName(chainId),
      is_default: chainId === defaultChainId,
    }));
  }, [paymentConfig]);

  const selectedPaymentChain =
    availableChainList.find((chain) => chain.chain_id === selectedPaymentChainId) ||
    availableChainList.find((chain) => chain.is_default) ||
    availableChainList[0];
  const effectivePaymentChainId = Number(
    selectedPaymentChain?.chain_id ||
      selectedPaymentChainId ||
      paymentConfig?.default_chain_id ||
      paymentConfig?.chain_id ||
      137,
  );

  const availableTokenList: PaymentTokenOption[] = useMemo(() => {
    const configured = Array.isArray(paymentConfig?.tokens) ? paymentConfig?.tokens || [] : [];
    const clean = configured
      .filter((row) => row && typeof row.address === "string" && row.address.startsWith("0x"))
      .map((row) => ({
        ...row,
        address: String(row.address).toLowerCase(),
        symbol: String(row.symbol || "USDC"),
        name: String(row.name || row.symbol || "USDC"),
        code: String(row.code || "usdc"),
        chain_id: Number(row.chain_id || effectivePaymentChainId),
        decimals: Number.isFinite(Number(row.decimals))
          ? Number(row.decimals)
          : Number(paymentConfig?.token_decimals ?? 6),
      }))
      .filter((row) => Number(row.chain_id) === effectivePaymentChainId);
    if (clean.length) return clean;
    const fallbackAddress = String(paymentConfig?.token_address || "").toLowerCase();
    if (!fallbackAddress.startsWith("0x")) return [];
    return [{
      code: "usdc", symbol: "USDC", name: "USDC", address: fallbackAddress,
      chain_id: effectivePaymentChainId,
      decimals: Number(paymentConfig?.token_decimals ?? 6),
      receiver_contract: paymentConfig?.receiver_contract, is_default: true,
    }];
  }, [effectivePaymentChainId, paymentConfig]);

  const resolvedSelectedTokenAddress = String(
    (
      selectedTokenAddress &&
      availableTokenList.some((row) => row.address === String(selectedTokenAddress).toLowerCase())
        ? selectedTokenAddress
        : ""
    ) ||
      availableTokenList.find((row) => row.is_default)?.address ||
      paymentConfig?.default_token_address ||
      availableTokenList.find((row) => row.is_default)?.address ||
      availableTokenList[0]?.address || paymentConfig?.token_address || "",
  ).toLowerCase();

  const selectedPaymentToken = availableTokenList.find(
    (row) => row.address === resolvedSelectedTokenAddress,
  ) || availableTokenList[0];

  const selectedTokenLabel = selectedPaymentToken?.symbol ||
    (resolvedSelectedTokenAddress.startsWith("0x") ? shortAddress(resolvedSelectedTokenAddress) : "USDC");

  const paymentReceiverAddress = EXPECTED_PAYMENT_RECEIVER_ADDRESS;

  // ── fetchLatestPaymentConfig ────────────────────────────
  const fetchLatestPaymentConfig = useCallback(
    async (authHeaders?: Record<string, string>, syncState = true): Promise<PaymentConfig> => {
      const headers = authHeaders || (await buildAuthedHeaders(false));
      const configRes = await fetch("/api/payments/config", { cache: "no-store", headers });
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
        const chainOptions = Array.isArray(configJson.chains)
          ? configJson.chains.filter((row) => Number(row?.chain_id) > 0)
          : [];
        const defaultChainId = Number(
          configJson.default_chain_id ||
            chainOptions.find((row) => row.is_default)?.chain_id ||
            configJson.chain_id ||
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
        const tokenOptions = Array.isArray(configJson.tokens)
          ? configJson.tokens.filter((row) => typeof row?.address === "string" && String(row.address).startsWith("0x"))
          : [];
        const tokenOptionsForChain = tokenOptions.filter(
          (row) => Number(row.chain_id || activeChainId) === activeChainId,
        );
        const defaultTokenAddress = String(
          configJson.default_token_address ||
            tokenOptionsForChain.find((row) => row.is_default)?.address ||
            tokenOptionsForChain[0]?.address ||
            tokenOptions.find((row) => row.is_default)?.address ||
            tokenOptions[0]?.address || configJson.token_address || "",
        ).toLowerCase();
        if (defaultTokenAddress) {
          const tokenSet = new Set(tokenOptionsForChain.map((row) => String(row.address).toLowerCase()));
          setSelectedTokenAddress((prev: string) =>
            prev && tokenSet.has(String(prev).toLowerCase()) ? prev : defaultTokenAddress,
          );
        }
      }
      return configJson;
    },
    [buildAuthedHeaders, selectedPaymentChainId, selectedPlanCode],
  );

  // ── pollIntentUntilConfirmed ────────────────────────────
  const pollIntentUntilConfirmed = useCallback(
    async (intentId: string, authHeaders: Record<string, string>, txHashHint = "", timeoutMs = 180000, pollMs = 5000) => {
      const startedAt = Date.now();
      const shortTx = shortAddress(txHashHint);
      while (Date.now() - startedAt < timeoutMs) {
        const statusRes = await fetch(`/api/payments/intents/${intentId}`, {
          method: "GET", headers: authHeaders, cache: "no-store",
        });
        if (!statusRes.ok) {
          if (statusRes.status >= 500 || statusRes.status === 429) {
            await new Promise((resolve) => setTimeout(resolve, pollMs));
            continue;
          }
          const raw = (await statusRes.text()).slice(0, 260);
          throw new Error(copy.queryIntentFailed.replace("{raw}", raw));
        }
        const statusJson = (await statusRes.json()) as IntentStatusResponse;
        const intent = statusJson.intent || {};
        const status = String(intent.status || "").toLowerCase();
        const txHash = String(intent.tx_hash || txHashHint || "").toLowerCase();
        if (status === "confirmed") {
          setPaymentError("");
          setPaymentInfo(copy.paymentConfirmed.replace("{txHash}", shortAddress(txHash)));
          trackPaymentSuccess({
            entry: "account_center",
            plan_code: selectedPlan?.plan_code || "pro_monthly",
            intent_id: intentId,
            tx_hash: txHash || null,
          });
          await refreshEntitlementAfterPayment();
          await loadPaymentSnapshot();
          return;
        }
        if (status === "failed" || status === "cancelled" || status === "expired") {
          throw new Error(copy.paymentStatus.replace("{status}", status));
        }
        setPaymentInfo(copy.txSubmitted.replace("{txHash}", shortTx).replace("{status}", status || "submitted"));
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      throw new Error(copy.paymentPendingTimeout);
    },
    [loadPaymentSnapshot, refreshEntitlementAfterPayment, selectedPlan?.plan_code, trackPaymentSuccess],
  );

  // ── createIntentAndPay ──────────────────────────────────
  const createIntentAndPay = async () => {
    clearPaymentMessages();
    clearPaymentState();
    clearStoredPaymentRecovery();
    if (!paymentHostAllowed) {
      setPaymentError(copy.paymentHostBlocked.replace("{host}", allowedPaymentHosts[0] || "polyweather.top"));
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

    const fallbackWallet = String(selectedWallet || walletAddress || boundWallets[0]?.address || "").toLowerCase();
    if (!fallbackWallet) {
      setPaymentError(copy.bindFirstBeforePay);
      return;
    }

    setPaymentBusy(true);
    let approvedInThisRun = false;
    try {
      const authReady = await verifyPaymentAuthReady();
      const authHeaders = authReady.authHeaders;
      const providerSelection = await resolvePaymentProvider(providerMode, selectedInjectedProviderKey);
      const eth = providerSelection.provider;
      const activeAccounts = await requestWalletWithTimeout<string[]>(
        eth, { method: "eth_requestAccounts" }, "连接付款钱包",
      );
      const activeAddress = String(activeAccounts?.[0] || "").toLowerCase();
      if (!activeAddress) throw new Error(isEn ? "Wallet account is empty." : "钱包账户为空");

      const boundAddrSet = new Set(boundWallets.map((row) => String(row.address || "").toLowerCase()));
      if (boundAddrSet.size > 0 && !boundAddrSet.has(activeAddress)) {
        throw new Error(`当前连接钱包 ${shortAddress(activeAddress)} 未绑定，请先绑定该地址后支付。`);
      }
      const payingWallet = boundAddrSet.has(activeAddress) ? activeAddress : fallbackWallet;

      setSelectedWallet(payingWallet);
      setProviderMode(providerSelection.mode);

      const latestConfig = await fetchLatestPaymentConfig(authHeaders, true);
      if (!latestConfig?.enabled || !latestConfig?.configured) throw new Error(copy.payNotReady);
      const targetChainId = Number(selectedPaymentChainId || latestConfig.default_chain_id || latestConfig.chain_id || 137);
      const latestChains = Array.isArray(latestConfig.chains) ? latestConfig.chains : [];
      const targetChain =
        latestChains.find((chain) => Number(chain.chain_id) === targetChainId) ||
        selectedPaymentChain;
      const latestTokens = Array.isArray(latestConfig.tokens) ? latestConfig.tokens : [];
      const selectedLatestToken =
        latestTokens.find(
          (token) =>
            Number(token.chain_id || targetChainId) === targetChainId &&
            String(token.address || "").toLowerCase() === resolvedSelectedTokenAddress,
        ) ||
        latestTokens.find(
          (token) => Number(token.chain_id || targetChainId) === targetChainId && token.is_default,
        ) ||
        latestTokens.find((token) => Number(token.chain_id || targetChainId) === targetChainId);
      if (selectedLatestToken?.supports_contract_checkout === false) {
        throw new Error(
          isEn
            ? `${selectedLatestToken.chain_name || chainIdToDisplayName(targetChainId)} ${selectedLatestToken.symbol || "USDC"} supports manual transfer only.`
            : `${selectedLatestToken.chain_name || chainIdToDisplayName(targetChainId)} ${selectedLatestToken.symbol || "USDC"} 仅支持手动转账。`,
        );
      }
      const expectedReceiver = String(selectedLatestToken?.receiver_contract || latestConfig.receiver_contract || "").toLowerCase();
      assertExpectedPaymentReceiver(expectedReceiver, "payment receiver contract");
      if (paymentConfig?.receiver_contract && String(paymentConfig.receiver_contract).toLowerCase() !== expectedReceiver) {
        setPaymentInfo(copy.paymentConfigUpdated.replace("{address}", shortAddress(expectedReceiver)));
      } else {
        setPaymentInfo(copy.currentReceiver.replace("{address}", shortAddress(expectedReceiver)));
      }

      await ensureTargetChain(eth, targetChainId, targetChain);

      const createRes = await fetch("/api/payments/intents", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          plan_code: selectedPlan?.plan_code || "pro_monthly",
          payment_mode: "strict",
          allowed_wallet: payingWallet,
          chain_id: targetChainId,
          token_address: String(selectedLatestToken?.address || resolvedSelectedTokenAddress || "").toLowerCase() || undefined,
          use_points: billing.canRedeem && usePoints,
          points_to_consume: billing.canRedeem && usePoints ? billing.pointsUsed : 0,
          metadata: {
            source: "account_center",
            frontend_host: currentPaymentHost || null,
            account_email: backend?.email || null,
            auth_confirmed_at: authReady.auth_confirmed_at,
          },
        }),
      });
      if (!createRes.ok) {
        const raw = (await createRes.text()).slice(0, 350);
        throw new Error(copy.createIntentFailed.replace("{raw}", raw));
      }

      const created = (await createRes.json()) as CreatedIntent;
      const intentId = String(created.intent?.intent_id || "");
      const txPayload = created.tx_payload;
      if (!intentId || !txPayload?.to || !txPayload?.data) throw new Error(copy.intentPayloadInvalid);
      trackPaymentStart({
        entry: "account_center",
        plan_code: selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        use_points: billing.canRedeem && usePoints,
        pay_amount_usd: billing.payAmount,
      });
      const intentReceiver = String(txPayload.to || "").toLowerCase();
      if (intentReceiver !== expectedReceiver) {
        throw new Error(`payment receiver changed: expected ${expectedReceiver}, got ${intentReceiver}. 请刷新页面后重试。`);
      }
      setLastIntentId(intentId);

      const tokenAddress = String(txPayload.token_address || "").toLowerCase();
      const amountUnits = BigInt(String(txPayload.amount_units || "0"));
      if (!tokenAddress.startsWith("0x") || amountUnits <= 0n) throw new Error(copy.intentTokenInvalid);
      const tokenSymbol = String(txPayload.token_symbol || selectedPaymentToken?.symbol || selectedTokenLabel || "USDC");
      const tokenDecimals = Number(txPayload.token_decimals ?? selectedPaymentToken?.decimals ?? latestConfig?.token_decimals ?? 6);

      const balanceHex = await requestWalletWithTimeout<string>(
        eth, { method: "eth_call", params: [{ to: tokenAddress, data: buildBalanceOfCalldata(payingWallet) }, "latest"] },
        `读取 ${tokenSymbol} 余额`,
      );
      const tokenBalance = BigInt(String(balanceHex || "0x0"));
      if (tokenBalance < amountUnits) {
        const need = formatTokenUnits(amountUnits, tokenDecimals);
        const have = formatTokenUnits(tokenBalance, tokenDecimals);
        throw new Error(`支付代币余额不足：需要 ${need} ${tokenSymbol}，当前 ${have} ${tokenSymbol}。请确认你钱包里持有该支付币种。`);
      }

      const allowanceHex = await requestWalletWithTimeout<string>(
        eth, { method: "eth_call", params: [{ to: tokenAddress, data: buildAllowanceCalldata(payingWallet, txPayload.to) }, "latest"] },
        `读取 ${tokenSymbol} 授权额度`,
      );
      const allowance = BigInt(String(allowanceHex || "0x0"));

      if (allowance < amountUnits) {
        setPaymentInfo(copy.approvalDetected.replace("{symbol}", tokenSymbol));
        const approveParams: Record<string, any> = {
          from: payingWallet, to: tokenAddress, data: buildApproveCalldata(txPayload.to, amountUnits),
        };
        const approveHash = await requestWalletWithTimeout<string>(
          eth, { method: "eth_sendTransaction", params: [approveParams] },
          `发起 ${tokenSymbol} 授权`, WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
        );
        await waitForReceipt(String(approveHash || ""), eth);
        approvedInThisRun = true;
        setPaymentInfo(copy.approvalDone.replace("{symbol}", tokenSymbol));
      } else {
        setPaymentInfo(copy.approvalSufficient);
      }

      const payParams: Record<string, any> = { from: payingWallet, to: txPayload.to, data: txPayload.data };
      if (txPayload.value && txPayload.value !== "0x0" && txPayload.value !== "0") {
        payParams.value = txPayload.value;
      }

      const txHash = await requestWalletWithTimeout<string>(
        eth, { method: "eth_sendTransaction", params: [payParams] },
        "发起支付交易", WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
      );
      const txHashNorm = String(txHash || "").toLowerCase();
      setLastTxHash(txHashNorm);
      setLastPaymentStartedAt(Date.now());
      setPaymentInfo(`交易已提交: ${shortAddress(txHashNorm)}，等待链上回执...`);
      await waitForReceipt(txHashNorm, eth);

      const submitRes = await fetch(`/api/payments/intents/${intentId}/submit`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ tx_hash: txHashNorm, from_address: payingWallet }),
      });
      if (!submitRes.ok) {
        const raw = (await submitRes.text()).slice(0, 350);
        if (submitRes.status === 409) {
          if (handleSubmit409Ref.current) await handleSubmit409Ref.current(intentId, txHashNorm, raw);
          return;
        }
        throw new Error(copy.submitTxFailed.replace("{raw}", raw));
      }

      const confirmRes = await fetch(`/api/payments/intents/${intentId}/confirm`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ tx_hash: txHashNorm }),
      });
      if (!confirmRes.ok) {
        const raw = (await confirmRes.text()).slice(0, 350);
        const lowerRaw = raw.toLowerCase();
        const maybePending =
          (confirmRes.status === 404 && !lowerRaw.includes("payment intent not found")) ||
          confirmRes.status === 408 ||
          (confirmRes.status === 409 && (lowerRaw.includes("confirmations not enough") || lowerRaw.includes("tx indexed partially")));
        if (maybePending) {
          setPaymentInfo(`交易已提交: ${shortAddress(txHashNorm)}，等待链上确认中...`);
          await pollIntentUntilConfirmed(intentId, authHeaders, txHashNorm);
          return;
        }
        throw new Error(copy.confirmFailed.replace("{raw}", raw));
      }

      setPaymentInfo(copy.paymentConfirmed.replace("{txHash}", shortAddress(txHashNorm)));
      trackPaymentSuccess({
        entry: "account_center",
        plan_code: selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentId,
        tx_hash: txHashNorm,
      });
      await refreshEntitlementAfterPayment();
      await loadPaymentSnapshot();
    } catch (error) {
      const normalized = normalizePaymentError(error);
      if (normalized.pending) {
        setPaymentError(normalized.message);
      } else if (normalized.userRejected) {
        setPaymentInfo(approvedInThisRun
          ? `${selectedTokenLabel} 授权已完成，本次支付已取消，可直接再次点击支付。`
          : ""
        );
        setPaymentError(normalized.message);
      } else {
        setPaymentInfo(approvedInThisRun
          ? `${selectedTokenLabel} 授权已完成，但支付未完成，请重试。`
          : ""
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
      setPaymentError(copy.paymentHostBlocked.replace("{host}", allowedPaymentHosts[0] || "polyweather.top"));
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
      const authHeaders = await buildAuthedHeaders(true, true);
      const createRes = await fetch("/api/payments/intents", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          plan_code: selectedPlan?.plan_code || "pro_monthly",
          payment_mode: "direct",
          chain_id: effectivePaymentChainId,
          token_address: resolvedSelectedTokenAddress || undefined,
          use_points: billing.canRedeem && usePoints,
          points_to_consume: billing.canRedeem && usePoints ? billing.pointsUsed : 0,
          metadata: {
            source: "account_center_manual_transfer",
            frontend_host: currentPaymentHost || null,
            account_email: backend?.email || null,
          },
        }),
      });
      if (!createRes.ok) {
        const raw = (await createRes.text()).slice(0, 350);
        throw new Error(copy.createManualIntentFailed.replace("{raw}", raw));
      }

      const created = (await createRes.json()) as CreatedIntent;
      const direct = created.direct_payment;
      const intentId = String(created.intent?.intent_id || direct?.intent_id || "");
      if (!intentId || !direct?.receiver_address || !direct?.amount_usdc) {
        throw new Error(copy.manualPaymentInvalid);
      }
      assertExpectedPaymentReceiver(direct.receiver_address, "manual payment receiver");
      setLastIntentId(intentId);
      setManualPayment(direct);
      setPaymentMethodTab("manual");
      setShowOverlay(false);
      const chainName = direct.chain_name || chainIdToDisplayName(direct.chain_id);
      setPaymentInfo(
        copy.manualOrderCreated
          .replace("{amount}", direct.amount_usdc)
          .replace("{symbol}", direct.token_symbol || selectedTokenLabel)
          .replace("{chain}", chainName)
          .replace("{receiver}", shortAddress(direct.receiver_address)),
      );
      trackPaymentStart({
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

  // ── submitManualPaymentTx ──────────────────────────────
  const submitManualPaymentTx = async () => {
    const txHashNorm = String(manualTxHash || "").trim().toLowerCase();
    const intentIdVal = String(lastIntentId || manualPayment?.intent_id || "").trim();
    if (!intentIdVal || !manualPayment) {
      setPaymentError(copy.manualOrderRequired);
      return;
    }
    if (!txHashNorm.startsWith("0x") || txHashNorm.length !== 66) {
      setPaymentError(copy.txHashRequired);
      return;
    }
    setPaymentBusy(true);
    setPaymentError("");
    try {
      const authHeaders = await buildAuthedHeaders(true, true);
      const submitRes = await fetch(`/api/payments/intents/${intentIdVal}/submit`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ tx_hash: txHashNorm }),
      });
      if (!submitRes.ok) {
        const raw = (await submitRes.text()).slice(0, 350);
        if (submitRes.status === 409) {
          if (handleSubmit409Ref.current) await handleSubmit409Ref.current(intentIdVal, txHashNorm, raw);
          return;
        }
        throw new Error(copy.submitTxFailed.replace("{raw}", raw));
      }
      const confirmRes = await fetch(`/api/payments/intents/${intentIdVal}/confirm`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ tx_hash: txHashNorm }),
      });
      if (!confirmRes.ok) {
        const raw = (await confirmRes.text()).slice(0, 350);
        const lowerRaw = raw.toLowerCase();
        const maybePending =
          confirmRes.status === 408 ||
          (confirmRes.status === 409 && (lowerRaw.includes("confirmations not enough") || lowerRaw.includes("tx indexed partially")));
        if (maybePending) {
          setPaymentInfo(`交易已提交: ${shortAddress(txHashNorm)}，等待链上确认中...`);
          await pollIntentUntilConfirmed(intentIdVal, authHeaders, txHashNorm);
          return;
        }
        throw new Error(copy.confirmFailed.replace("{raw}", raw));
      }
      setLastTxHash(txHashNorm);
      setPaymentInfo(copy.paymentConfirmed.replace("{txHash}", shortAddress(txHashNorm)));
      setManualPayment(null);
      setManualTxHash("");
      setTxValidation({ loading: false, checked: false });
      trackPaymentSuccess({
        entry: "account_center_manual_transfer",
        plan_code: selectedPlan?.plan_code || "pro_monthly",
        intent_id: intentIdVal,
        tx_hash: txHashNorm,
      });
      await refreshEntitlementAfterPayment();
      await loadPaymentSnapshot();
    } catch (error) {
      setPaymentError(normalizePaymentError(error).message);
    } finally {
      setPaymentBusy(false);
    }
  };

  // ── validateTxHash ────────────────────────────────────
  const validateTxHash = useCallback(
    async (intentId: string, hash: string) => {
      const hashNorm = String(hash || "").trim().toLowerCase();
      if (!hashNorm.startsWith("0x") || hashNorm.length !== 66) {
        setTxValidation({ loading: false, checked: false });
        return;
      }
      setTxValidation({ loading: true, checked: false });
      try {
        const headers = await buildAuthedHeaders(true, true);
        const res = await fetch(`/api/payments/intents/${intentId}/validate`, {
          method: "POST", headers, body: JSON.stringify({ tx_hash: hashNorm }),
        });
        const json = (await res.json()) as {
          valid?: boolean; reason?: string; detail?: string; checks?: Record<string, unknown>;
        };
        setTxValidation({ loading: false, checked: true, valid: Boolean(json.valid), reason: json.reason, detail: json.detail, checks: json.checks });
      } catch {
        setTxValidation({ loading: false, checked: false });
      }
    },
    [buildAuthedHeaders],
  );

  // ── handleOverlayCheckout ──────────────────────────────
  const handleOverlayCheckout = async () => {
    if (!paymentHostAllowed) {
      setPaymentError(copy.paymentHostBlocked.replace("{host}", allowedPaymentHosts[0] || "polyweather.top"));
      return;
    }
    if (!authIsAuthenticated) {
      setPaymentError(copy.loginBeforePay);
      return;
    }
    if (!hasPayingWallet) {
      setPaymentInfo(copy.openBindFlow);
      if (connectAndBindWalletRef.current) {
        const bound = await connectAndBindWalletRef.current(providerMode, { openOverlayAfterBind: true });
        if (!bound) return;
      }
      setPaymentInfo(copy.walletBoundCreatingOrder);
      await createIntentAndPay();
      return;
    }
    await createIntentAndPay();
  };

  // ==========================================================
  return {
    fetchLatestPaymentConfig,
    pollIntentUntilConfirmed,
    createIntentAndPay,
    createManualPaymentIntent,
    submitManualPaymentTx,
    validateTxHash,
    handleOverlayCheckout,
    availableTokenList,
    availableChainList,
    selectedPaymentChain,
    resolvedSelectedTokenAddress,
    selectedPaymentToken,
    selectedTokenLabel,
    paymentReceiverAddress,
  };
}
