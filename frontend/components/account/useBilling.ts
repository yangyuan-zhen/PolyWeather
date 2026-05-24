"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  getAllowedPaymentHosts,
  getCurrentPaymentHost,
  isPaymentHostAllowed,
} from "@/lib/payment-host";
import type {
  AuthMeResponse,
  PaymentConfig,
  PaymentRecoveryState,
  TelegramPricing,
} from "./types";
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  PAYMENT_RECOVERY_TTL_MS,
} from "./constants";
import { clearStoredPaymentRecovery, shortAddress } from "./formatters";
import { normalizePaymentError } from "./payment-utils";
import { trackAppEvent } from "@/lib/app-analytics";

// ============================================================
export interface UseBillingParams {
  isEn: boolean;
  copy: Record<string, string>;
  backend: AuthMeResponse | null;
  supabaseReady: boolean;

  // Shared state from master
  paymentConfig: PaymentConfig | null;
  authUserId: string;
  authIsAuthenticated: boolean;
  usePoints: boolean;
  setUsePoints: (v: boolean) => void;

  // Payment UI state from usePaymentState
  lastIntentId: string;
  lastTxHash: string;
  lastPaymentStartedAt: number;
  setLastIntentId: (v: string) => void;
  setLastTxHash: (v: string) => void;
  setLastPaymentStartedAt: (v: number) => void;
  setPaymentBusy: (v: boolean) => void;
  setPaymentInfo: (v: string) => void;
  setPaymentError: (v: string) => void;
  setTelegramBindOpening: (v: boolean) => void;
  clearPaymentState: () => void;

  // Derived / callbacks from master
  selectedPlan?: { plan_code?: string; amount_usdc?: string } | undefined;
  getValidAccessToken: () => Promise<string>;
  buildAuthedHeaders: (withJson?: boolean, requireAuth?: boolean) => Promise<Record<string, string>>;
  loadSnapshot: () => Promise<void>;
  loadPaymentSnapshot: () => Promise<void>;

  // User for metadata points
  user: User | null;
}

// ============================================================
export function useBilling(params: UseBillingParams) {
  const {
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
    loadPaymentSnapshot,
    user,
  } = params;

  // ── Billing-specific state ────────────────────────────────
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [telegramBindUrl, setTelegramBindUrl] = useState("");

  // ── Derived values ──────────────────────────────────────
  const paymentReadyForRecovery = Boolean(paymentConfig?.enabled && paymentConfig?.configured);
  const hasRecentPaymentRecovery =
    Boolean(lastIntentId && lastTxHash && authUserId && lastPaymentStartedAt) &&
    Date.now() - lastPaymentStartedAt <= PAYMENT_RECOVERY_TTL_MS;
  const allowedPaymentHosts = useMemo(() => getAllowedPaymentHosts(), []);
  const currentPaymentHost = useMemo(() => getCurrentPaymentHost(), []);
  const paymentHostAllowed = useMemo(() => isPaymentHostAllowed(currentPaymentHost), [currentPaymentHost]);

  // ── Points computation ──────────────────────────────────
  const backendPointsRaw = Number(backend?.points);
  const metadataPointsRaw = Number(
    user?.user_metadata?.points ?? user?.user_metadata?.total_points ?? 0,
  );
  const metadataPointsSafe = Number.isFinite(metadataPointsRaw) ? metadataPointsRaw : 0;
  const pointsRaw = Number.isFinite(backendPointsRaw)
    ? Math.max(backendPointsRaw, metadataPointsSafe)
    : metadataPointsSafe;
  const totalPoints = Number.isFinite(pointsRaw) ? Math.max(0, pointsRaw) : 0;

  // ── Billing ──────────────────────────────────────────────
  const billing = useMemo(() => {
    const parsedPlanAmount = Number(
      backend?.telegram_pricing?.amount_usdc ?? selectedPlan?.amount_usdc ?? 10,
    );
    const planAmount = Number.isFinite(parsedPlanAmount) && parsedPlanAmount > 0 ? parsedPlanAmount : 10;

    const pointsCfg = paymentConfig?.points_redemption || {};
    const pointsEnabled = pointsCfg.enabled !== false;
    const pointsPerUsdcRaw = Number(pointsCfg.points_per_usdc ?? 500);
    const pointsPerUsdc =
      Number.isFinite(pointsPerUsdcRaw) && pointsPerUsdcRaw > 0 ? Math.floor(pointsPerUsdcRaw) : 500;

    const maxDiscountRaw = Number(pointsCfg.max_discount_usdc ?? 3);
    const maxDiscountUsdc = Math.max(
      0,
      Math.min(
        Math.floor(Number.isFinite(maxDiscountRaw) ? maxDiscountRaw : 3),
        Math.floor(planAmount),
      ),
    );

    const maxRedeemablePoints = pointsPerUsdc * maxDiscountUsdc;
    const actualRedeem = pointsEnabled ? Math.min(totalPoints, maxRedeemablePoints) : 0;
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
        method: "POST", headers,
      });
      if (!res.ok) return false;
      const json = (await res.json()) as {
        ok?: boolean; action?: string; subscription?: { plan_code?: string | null } | null;
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
    authIsAuthenticated, buildAuthedHeaders, copy.walletRecoveryDone,
    loadPaymentSnapshot, loadSnapshot, reconcileBusy,
  ]);

  // ── handleSubmit409 ────────────────────────────────────
  const handleSubmit409 = useCallback(
    async (intentId: string, txHashNorm: string, raw: string) => {
      const lowerRaw = raw.toLowerCase();
      if (lowerRaw.includes("已支付") || lowerRaw.includes("already confirmed") || lowerRaw.includes("already paid")) {
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
        const intentRes = await fetch(`/api/payments/intents/${intentId}`, { headers, cache: "no-store" });
        if (intentRes.ok) {
          const intentJson = (await intentRes.json()) as {
            intent?: { status?: string; tx_hash?: string };
          };
          const status = intentJson.intent?.status;
          if (status === "confirmed") {
            await reconcileLatestPayment();
            const txHash = intentJson.intent?.tx_hash || txHashNorm;
            setPaymentInfo(`支付已确认，交易: ${shortAddress(txHash)}`);
            setPaymentError("");
            await loadSnapshot();
            await loadPaymentSnapshot();
            return;
          }
          if (status === "expired") throw new Error(copy.orderExpired);
        }
      } catch (e) {
        if (e instanceof Error && e.message !== raw) throw e;
      }
      throw new Error(copy.submitTxFailed.replace("{raw}", raw));
    },
    [buildAuthedHeaders, copy, loadPaymentSnapshot, loadSnapshot, reconcileLatestPayment],
  );

  // ── openTelegramBotBindLink ──────────────────────────────
  const openTelegramBotBindLink = async () => {
    setTelegramBindOpening(true);
    setPaymentError("");
    setTelegramBindUrl("");
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const authHeaders = await buildAuthedHeaders(true, false);
      const res = await fetch("/api/auth/telegram/bot-bind-link", {
        method: "POST", headers: authHeaders,
      });
      if (!res.ok) {
        const raw = (await res.text()).slice(0, 300);
        throw new Error(raw || copy.telegramBindFailed);
      }
      const data = (await res.json()) as { bot_url?: string };
      const botUrl = String(data.bot_url || "").trim();
      if (!botUrl) throw new Error(copy.telegramBindLinkMissing);
      if (popup && !popup.closed) {
        popup.location.href = botUrl;
        setPaymentInfo(copy.telegramBindClickHint);
      } else {
        setPaymentInfo(copy.telegramPopupBlocked);
        setTelegramBindUrl(botUrl);
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      setPaymentError(normalizePaymentError(error).message);
    } finally {
      setTelegramBindOpening(false);
    }
  };

  // ── loadPaymentSnapshot effect ────────────────────────────
  useEffect(() => {
    void loadPaymentSnapshot();
  }, [loadPaymentSnapshot]);

  // ── Recovery save effect ────────────────────────────────
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
    window.sessionStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(payload));
  }, [authUserId, lastIntentId, lastPaymentStartedAt, lastTxHash]);

  // ── Recovery restore effect ──────────────────────────────
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
      const txHash = String(parsed?.txHash || "").trim().toLowerCase();
      const createdAt = Number(parsed?.createdAt || 0);
      const expired = !createdAt || Date.now() - createdAt > PAYMENT_RECOVERY_TTL_MS;
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

  // ── Subscription cleanup effect ──────────────────────────
  useEffect(() => {
    if (!backend?.subscription_active) return;
    clearPaymentState();
    clearStoredPaymentRecovery();
  }, [backend?.subscription_active]);

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
    return () => { cancelled = true; };
  }, [
    backend?.subscription_active, authIsAuthenticated, copy.walletRecoveryBusy,
    copy.walletRecoveryFailed, hasRecentPaymentRecovery,
    paymentReadyForRecovery, reconcileLatestPayment,
  ]);

  // ── bind_token URL effect ──────────────────────────────
  useEffect(() => {
    if (!authIsAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("bind_token");
    if (!token) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("bind_token");
    window.history.replaceState(null, "", url.toString());
    (async () => {
      setPaymentError("");
      setPaymentInfo("");
      try {
        const authHeaders = await buildAuthedHeaders(true, false);
        const res = await fetch("/api/auth/telegram/bind-by-token", {
          method: "POST", headers: authHeaders, body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          const raw = (await res.text()).slice(0, 350);
          throw new Error(copy.bindFailed.replace("{raw}", raw));
        }
        const data = (await res.json()) as { telegram_pricing?: TelegramPricing | null };
        if (data.telegram_pricing?.is_group_member) {
          const amount = data.telegram_pricing.amount_usdc || "10";
          setPaymentInfo(copy.telegramVerifySuccess.replace("{amount}", amount));
        }
        await loadSnapshot();
        await loadPaymentSnapshot();
      } catch (error) {
        setPaymentError(normalizePaymentError(error).message);
      }
    })();
  }, [authIsAuthenticated, buildAuthedHeaders, loadPaymentSnapshot, loadSnapshot]);

  // ==========================================================
  return {
    reconcileBusy,
    telegramBindUrl,
    setTelegramBindUrl,
    reconcileLatestPayment,
    handleSubmit409,
    openTelegramBotBindLink,
    paymentReadyForRecovery,
    hasRecentPaymentRecovery,
    allowedPaymentHosts,
    currentPaymentHost,
    paymentHostAllowed,
    totalPoints,
    billing,
  };
}
