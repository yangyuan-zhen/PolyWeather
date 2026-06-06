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
import { markAnalyticsOnce, trackAppEvent } from "@/lib/app-analytics";
import { useI18n } from "@/hooks/useI18n";
import { UnlockProOverlay } from "@/components/subscription/UnlockProOverlay";

import type { AuthMeResponse } from "./types";
import {
  SUBSCRIPTION_HELP_HREF,
  TELEGRAM_BOT_URL,
  TELEGRAM_GROUP_URL,
  TELEGRAM_TOPICS_GROUP_URL,
  WALLETCONNECT_PROJECT_ID,
} from "./constants";
import { InfoRow, PlusIcon } from "./AccountInfoRow";
import { AccountFeedbackPanel } from "./AccountFeedbackPanel";
import {
  chainIdToDisplayName,
  clearStoredPaymentRecovery,
  formatTime,
  parseSubscriptionExpiry,
  shortAddress,
} from "./formatters";
import { createAccountCopy } from "./account-copy";
import { resetWalletConnectProvider } from "./wallet";
import { useAccountPayment } from "./useAccountPayment";

// --- Main Component ---

export function AccountCenter() {
  const router = useRouter();
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const copy = useMemo(() => createAccountCopy(isEn), [isEn]);

  // ── UI-only state ──────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSecondarySections, setShowSecondarySections] = useState(false);

  // ── Shared state (declared in component, written by hook via setters) ─
  const [showOverlay, setShowOverlay] = useState(false);
  const [usePoints, setUsePoints] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [user, setUser] = useState<User | null>(null);
  const [backend, setBackend] = useState<AuthMeResponse | null>(null);
  const [referralCodeInput, setReferralCodeInput] = useState("");
  const [referralApplying, setReferralApplying] = useState(false);

  const supabaseReady = hasSupabasePublicEnv();
  const walletConnectEnabled = Boolean(WALLETCONNECT_PROJECT_ID);

  // ── Hook ────────────────────────────────────────────────
  const {
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

    // Setters
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
    selectedPaymentChainId,
    selectedTokenAddress,
    selectedWallet,
    providerMode,
    injectedProviderOptions,
    selectedInjectedProviderKey,
    reconcileBusy,

    // Shared setters
    setSelectedTokenAddress,
    setSelectedPaymentChainId,
    setSelectedPlanCode,
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
    availableChainList,
    selectedPaymentChain,
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
  } = useAccountPayment({
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
  });

  // ── Auth analytics effect ──────────────────────────────
  useEffect(() => {
    if (!authIsAuthenticated || !authUserId) return;
    const actorKey = authUserId.toLowerCase();
    const subscriptionPlanCode = String(backend?.subscription_plan_code || "").trim();
    const subscriptionSource = String(backend?.subscription_source || "").trim();
    const trialSubscription = Boolean(
      backend?.subscription_is_trial === true ||
        subscriptionPlanCode.toLowerCase().includes("trial") ||
        subscriptionSource.toLowerCase().includes("trial"),
    );
    if (markAnalyticsOnce(`signup_completed:${actorKey}`, "local")) {
      trackAppEvent("signup_completed", {
        entry: "account_center",
        user_id: authUserId,
      });
    }
    if (markAnalyticsOnce(`signup_success:${actorKey}`, "local")) {
      trackAppEvent("signup_success", {
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
    if (trialSubscription && markAnalyticsOnce(`trial_created:${actorKey}`, "local")) {
      trackAppEvent("trial_created", {
        entry: "account_center",
        user_id: authUserId,
        subscription_plan_code: subscriptionPlanCode || null,
        subscription_source: subscriptionSource || null,
        subscription_expires_at: backend?.subscription_expires_at || null,
        subscription_is_trial: backend?.subscription_is_trial === true,
      });
    }
  }, [
    authIsAuthenticated,
    authUserId,
    backend?.subscription_expires_at,
    backend?.subscription_is_trial,
    backend?.subscription_plan_code,
    backend?.subscription_source,
  ]);

  // ── Idle callback effect ──────────────────────────────
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

  // ── Initial load effect ────────────────────────────────
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

  // ── Refresh ────────────────────────────────────────────
  const onRefresh = async () => {
    setRefreshing(true);
    await loadSnapshot();
    await loadPaymentSnapshot();
    setRefreshing(false);
  };

  // ── Sign out ────────────────────────────────────────────
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

  // ── Derived display values ──────────────────────────────
  const userId = backend?.user_id || user?.id || "";
  const isAuthenticated = Boolean(userId);
  const email = backend?.email || user?.email || "";
  const displayName =
    String(user?.user_metadata?.full_name || "").trim() ||
    (email ? String(email).split("@")[0] : "") ||
    copy.guestUser;
  const initials = (displayName.slice(0, 2) || "PW").toUpperCase();
  const joinedAt = formatTime(user?.created_at, locale);
  const backendAuthenticated = backend?.authenticated === true;
  const localAuthenticated = Boolean(user?.id);
  const isSubscriptionUnknown = Boolean(
    localAuthenticated &&
      (!backend ||
        backend.subscription_active == null ||
        backend.authenticated === false),
  );
  const isSubscribed = backend?.subscription_active === true;
  const subscriptionSource = String(backend?.subscription_source || "").trim();
  const isTrialSubscription = Boolean(
    backend?.subscription_is_trial === true ||
      String(backend?.subscription_plan_code || "").toLowerCase().includes("trial") ||
      subscriptionSource.toLowerCase().includes("trial"),
  );
  const subscriptionStatusLabel = isSubscribed
    ? isTrialSubscription
      ? copy.trialBadge
      : copy.proMember
    : isSubscriptionUnknown
      ? copy.subscriptionChecking
      : isEn
        ? "UNSUBSCRIBED"
        : "未订阅";
  const planCode = String(backend?.subscription_plan_code || "").trim();
  const currentExpiryRaw = String(
    backend?.subscription_expires_at ||
      user?.user_metadata?.pro_expiry ||
      "",
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
  const hasQueuedExtension = Boolean(
    isSubscribed && queuedExtensionDays > 0,
  );
  const canAccessPaidTelegramGroup = Boolean(isSubscribed && !isTrialSubscription);
  const hasTelegramPanel = Boolean(isTrialSubscription || canAccessPaidTelegramGroup);
  const telegramBound =
    Number(backend?.telegram_pricing?.telegram_id || 0) > 0;
  const displayExpiryRaw = isSubscribed
    ? totalExpiryRaw
    : currentExpiryRaw;
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
    : isSubscriptionUnknown
      ? copy.subscriptionUnknown
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
      !isSubscriptionUnknown &&
      (!isSubscribed || showExpiringSoon || showExpiredReminder),
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
  const expiryLabel = hasQueuedExtension
    ? copy.accessUntil
    : copy.renewalDate;
  const displayPlanList = effectivePlanList.length
    ? effectivePlanList
    : [
        { plan_code: "pro_monthly", plan_id: 101, amount_usdc: "29.9", duration_days: 30 },
        { plan_code: "pro_quarterly", plan_id: 102, amount_usdc: "79.9", duration_days: 90 },
      ];
  const selectedPlanDurationDays = Number(selectedPlan?.duration_days || 30);
  const overlayPlanLabel =
    selectedPlanCode === "pro_quarterly"
      ? copy.quarterlyPlan
      : copy.monthlyPlan;
  const overlayPeriodLabel = isEn
    ? `/ ${selectedPlanDurationDays} days`
    : `/ ${selectedPlanDurationDays} 天`;
  const referral = backend?.referral;
  const referralCode = String(referral?.code || "").trim();
  const appliedReferralCode = String(referral?.applied_code || "").trim();
  const canApplyReferralCode = Boolean(
    isAuthenticated &&
      !isSubscribed &&
      !appliedReferralCode &&
      referralCodeInput.trim(),
  );

  // ── Payment overlay tracking effect ──────────────────────
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

  // ── Referral points display ────────────────────────────
  const referralRewardPointsRaw = Number(referral?.reward_points ?? 3500);
  const referralRewardPoints = Number.isFinite(referralRewardPointsRaw)
    ? Math.max(0, referralRewardPointsRaw)
    : 3500;
  const monthlyReferralCountRaw = Number(referral?.monthly_reward_count ?? 0);
  const monthlyReferralCount = Number.isFinite(monthlyReferralCountRaw)
    ? Math.max(0, monthlyReferralCountRaw)
    : 0;
  const monthlyReferralLimitRaw = Number(referral?.monthly_reward_limit ?? 10);
  const monthlyReferralLimit = Number.isFinite(monthlyReferralLimitRaw)
    ? Math.max(0, monthlyReferralLimitRaw)
    : 10;
  const monthlyReferralPointsRaw = Number(
    referral?.monthly_reward_points ?? monthlyReferralCount * referralRewardPoints,
  );
  const monthlyReferralPoints = Number.isFinite(monthlyReferralPointsRaw)
    ? Math.max(0, monthlyReferralPointsRaw)
    : 0;
  const monthlyReferralPointsLimitRaw = Number(
    referral?.monthly_reward_points_limit ?? monthlyReferralLimit * referralRewardPoints,
  );
  const monthlyReferralPointsLimit = Number.isFinite(monthlyReferralPointsLimitRaw)
    ? Math.max(0, monthlyReferralPointsLimitRaw)
    : monthlyReferralLimit * referralRewardPoints;

  // ── Telegram bind command ──────────────────────────────
  const bindCommand = userId
    ? `/bind ${userId}${email ? ` ${email}` : ""}`
    : "/bind <supabase_user_id> <email>";

  // ── Copy handler ──────────────────────────────────────
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const applyReferralCode = useCallback(async () => {
    const code = referralCodeInput.trim();
    if (!code || referralApplying) return;
    setReferralApplying(true);
    setPaymentError("");
    setPaymentInfo("");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (supabaseReady) {
        const {
          data: { session },
        } = await getSupabaseBrowserClient().auth.getSession();
        const token = String(session?.access_token || "").trim();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch("/api/auth/referral/apply", {
        method: "POST",
        headers,
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const raw = (await res.text()).slice(0, 240);
        throw new Error(raw || copy.referralApplyFailed);
      }
      setPaymentInfo(copy.referralApplied);
      setReferralCodeInput("");
      await loadSnapshot();
      await loadPaymentSnapshot();
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : copy.referralApplyFailed,
      );
    } finally {
      setReferralApplying(false);
    }
  }, [
    copy.referralApplied,
    copy.referralApplyFailed,
    loadPaymentSnapshot,
    loadSnapshot,
    referralApplying,
    referralCodeInput,
    setPaymentError,
    setPaymentInfo,
    supabaseReady,
  ]);

  // ── Render ────────────────────────────────────────────

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
              className={`absolute -bottom-2 -right-2 rounded-lg border-4 border-white p-1.5 ${
                isSubscribed
                  ? "bg-amber-400 text-slate-950"
                  : isSubscriptionUnknown
                    ? "bg-blue-100 text-blue-500"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              <Crown size={16} fill="currentColor" />
            </div>
          </div>
          <div className="flex-grow text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-3 mb-1">
              <h2 className="text-3xl font-bold text-slate-950">{displayName}</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${
                  isSubscribed
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : isSubscriptionUnknown
                      ? "border-blue-200 bg-blue-50 text-blue-600"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                {subscriptionStatusLabel}
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
                {monthlyReferralCount.toLocaleString()}
              </p>
            </div>
            <div className="min-w-[140px] rounded-xl border border-blue-200 bg-blue-50 px-6 py-4 text-center">
              <p className="mb-1 text-[10px] font-bold uppercase text-blue-700">
                {copy.weeklyRank}
              </p>
              <p className="flex items-center justify-center gap-2 text-xl font-bold text-slate-950">
                <Trophy size={16} className="text-amber-400" />{" "}
                {monthlyReferralCount}/{monthlyReferralLimit}
              </p>
            </div>
          </div>
        </div>

        {/* Referral rewards */}
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
                    <Coins size={16} className="text-yellow-500" />{" "}
                    {copy.referralRewardHint}
                  </span>
                  <span className="text-xs font-bold text-amber-600">
                    +{referralRewardPoints.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm flex items-center gap-2">
                    <TrendingUp size={16} className="text-emerald-500" />{" "}
                    {copy.weeklyPoints}
                  </span>
                  <span className="text-xs font-bold text-slate-600">
                    {monthlyReferralCount}/{monthlyReferralLimit}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm flex items-center gap-2">
                    <Trophy size={16} className="text-blue-500" />{" "}
                    {copy.totalPoints}
                  </span>
                  <span className="text-xs font-bold text-orange-400">
                    {monthlyReferralPoints.toLocaleString()}/{monthlyReferralPointsLimit.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <Info size={14} className="text-slate-500 mt-0.5 shrink-0" />
              <p className="text-[10px] text-slate-500 leading-normal italic">
                {copy.pointsRule}
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
                value={
                  isSubscriptionUnknown
                    ? copy.subscriptionChecking
                    : isSubscribed
                      ? copy.deepMode
                      : copy.compactVisible
                }
                isPrimary={isSubscribed}
              />
              <InfoRow
                icon={Clock}
                label={copy.historyFuture}
                value={
                  isSubscriptionUnknown
                    ? copy.subscriptionChecking
                    : isSubscribed
                      ? copy.enabled
                      : copy.locked
                }
                isPrimary={isSubscribed}
              />
              <InfoRow
                icon={Bot}
                label={copy.smartPush}
                value={
                  isSubscriptionUnknown
                    ? copy.subscriptionChecking
                    : isSubscribed
                      ? copy.enabled
                      : copy.locked
                }
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
                value={
                  backendAuthenticated
                    ? copy.passed
                    : isSubscriptionUnknown
                      ? copy.subscriptionChecking
                      : copy.restricted
                }
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
                planLabel={overlayPlanLabel}
                periodLabel={overlayPeriodLabel}
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
                locale={locale}
                errorText={paymentError || undefined}
                infoText={paymentInfo || undefined}
                txHash={lastTxHash || undefined}
                chainId={selectedPaymentChainId || paymentConfig?.chain_id || 137}
                paymentTokenLabel={selectedTokenLabel}
                faqHref={SUBSCRIPTION_HELP_HREF}
                telegramGroupUrl=""
              />
            </div>
          )}
        </div>

        <AccountFeedbackPanel
          isEn={isEn}
          title={copy.accountFeedbackTitle}
          description={copy.accountFeedbackDescription}
          refreshLabel={copy.refresh}
        />

        {/* Telegram Bot Section & Payment Details */}
        {showSecondarySections ? (
          <div
            className={`lg:col-span-12 grid grid-cols-1 items-start gap-6 ${
              hasTelegramPanel ? "xl:grid-cols-[minmax(0,0.9fr)_minmax(620px,1.1fr)]" : ""
            }`}
          >
            {isTrialSubscription && (
              <section className="group relative min-w-0 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
                <Bot
                  size={140}
                  className="absolute -right-8 -bottom-8 -rotate-12 text-amber-100"
                />
                <div className="relative z-10">
                  <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-amber-800">
                    <Bot size={22} /> {copy.telegramBind}
                  </h3>
                  <p className="text-sm leading-6 text-amber-900">
                    {copy.trialPaidGroupLocked}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowOverlay(true)}
                    disabled={!canOpenCheckoutOverlay}
                    className="mt-5 inline-flex items-center gap-2 rounded-xl border border-amber-700 bg-amber-600 px-4 py-3 text-xs font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Crown size={14} />
                    {copy.upgradePro}
                  </button>
                </div>
              </section>
            )}
            {canAccessPaidTelegramGroup && (
              <section className="group relative min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
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
                      {telegramBindOpening
                        ? "..."
                        : copy.telegramBotBindLink}
                    </button>
                    <button
                      onClick={() => handleCopy(bindCommand)}
                      className="rounded-xl border border-blue-700 bg-blue-600 p-4 text-white shadow-sm transition-all hover:bg-blue-700"
                      title={copy.copyCommand}
                      aria-label={copy.copyCommand}
                    >
                      {copied ? (
                        <CheckCircle2 size={20} />
                      ) : (
                        <Copy size={20} />
                      )}
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
            <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-7">
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
                      allowedPaymentHosts[0] ||
                        "polyweather.top",
                    )}
                  </div>
                ) : null}
                <div
                  data-testid="payment-management-grid"
                  className={`grid gap-6 lg:items-start ${
                    hasTelegramPanel ? "" : "lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]"
                  }`}
                >
                  <div className="space-y-5">
                    <div>
                      <p className="mb-2 text-[11px] uppercase text-slate-500">
                        {copy.proPlan}
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {displayPlanList.map((plan) => {
                          const code = String(plan.plan_code || "");
                          const active = code === selectedPlanCode;
                          const isQuarterly = code === "pro_quarterly";
                          return (
                            <button
                              type="button"
                              key={code}
                              onClick={() => setSelectedPlanCode(code)}
                              disabled={paymentBusy}
                              className={`rounded-xl border px-3 py-3 text-left transition-all ${
                                active
                                  ? "border-blue-300 bg-blue-50 text-blue-900"
                                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-xs font-bold">
                                <span>
                                  {isQuarterly
                                    ? copy.quarterlyPlan
                                    : copy.monthlyPlan}
                                </span>
                                <span>{plan.amount_usdc} USDC</span>
                              </div>
                              <div className="mt-1 text-[10px] opacity-80">
                                {code} · {plan.duration_days} 天
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {appliedReferralCode && selectedPlanCode === "pro_monthly" ? (
                        <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                          {copy.referralDiscountHint}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs font-bold uppercase text-slate-700">
                          {copy.referralTitle}
                        </p>
                        <span className="text-[10px] text-slate-500">
                          {copy.referralInviteLimit}
                        </span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                        <div>
                          <p className="mb-1 text-[10px] uppercase text-slate-500">
                            {copy.referralMyCode}
                          </p>
                          <div className="flex gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-blue-700">
                              {referralCode || "--"}
                            </code>
                            {referralCode ? (
                              <button
                                type="button"
                                onClick={() => handleCopy(referralCode)}
                                className="rounded-xl border border-blue-700 bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
                              >
                                {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-2 text-[11px] leading-5 text-slate-500">
                            {copy.referralRewardHint}
                          </p>
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] uppercase text-slate-500">
                            {copy.referralApplyLabel}
                          </p>
                          {appliedReferralCode ? (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                              {appliedReferralCode}
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <input
                                value={referralCodeInput}
                                onChange={(event) => setReferralCodeInput(event.target.value)}
                                placeholder={copy.referralApplyPlaceholder}
                                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                              />
                              <button
                                type="button"
                                onClick={() => void applyReferralCode()}
                                disabled={!canApplyReferralCode || referralApplying}
                                className="rounded-xl border border-slate-900 bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {referralApplying ? "..." : copy.referralApplyButton}
                              </button>
                            </div>
                          )}
                          <p className="mt-2 text-[11px] leading-5 text-slate-500">
                            {copy.referralDiscountHint}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div
                      data-testid="payment-guard-grid"
                      className={`grid gap-3 ${hasTelegramPanel ? "" : "sm:grid-cols-2"}`}
                    >
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
                        value={
                          selectedPaymentChain?.name ||
                          chainIdToDisplayName(selectedPaymentChainId)
                        }
                      />
                      <InfoRow
                        icon={ExternalLink}
                        label={copy.paymentHost}
                        value={currentPaymentHost || "--"}
                      />
                      <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] leading-5 text-slate-500 sm:col-span-2">
                        {copy.paymentGuardHint}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-5">
                    {availableChainList.length > 1 && (
                      <div>
                        <p className="mb-2 text-[11px] uppercase text-slate-500">
                          {copy.paymentNetwork}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {availableChainList.map((chain) => {
                            const active = chain.chain_id === selectedPaymentChainId;
                            return (
                              <button
                                type="button"
                                key={chain.chain_id}
                                onClick={() => {
                                  setSelectedPaymentChainId(chain.chain_id);
                                  const nextToken =
                                    paymentConfig?.tokens?.find(
                                      (token) =>
                                        Number(token.chain_id || chain.chain_id) ===
                                          chain.chain_id &&
                                        token.is_default,
                                    ) ||
                                    paymentConfig?.tokens?.find(
                                      (token) =>
                                        Number(token.chain_id || chain.chain_id) ===
                                        chain.chain_id,
                                    );
                                  if (nextToken?.address) {
                                    setSelectedTokenAddress(
                                      String(nextToken.address).toLowerCase(),
                                    );
                                  }
                                }}
                                disabled={paymentBusy}
                                className={`rounded-xl border px-3 py-2 text-left transition-all ${
                                  active
                                    ? "border-blue-300 bg-blue-50 text-blue-900"
                                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                }`}
                              >
                                <div className="text-xs font-bold">
                                  {chain.name || chainIdToDisplayName(chain.chain_id)}
                                </div>
                                <div className="text-[10px] opacity-80">
                                  {chain.native_currency_symbol || "ETH"} gas
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {availableTokenList.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] uppercase text-slate-500">
                          {copy.paymentToken}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {availableTokenList.map((token) => {
                            const active =
                              token.address ===
                              (resolvedSelectedTokenAddress ||
                                token.address);
                            return (
                              <button
                                type="button"
                                key={`${token.chain_id || selectedPaymentChainId}:${token.address}`}
                                onClick={() =>
                                  setSelectedTokenAddress(
                                    token.address,
                                  )
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
                                <div className="truncate text-[10px] opacity-80">
                                  {token.name}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Payment Method Tabs */}
                    <div className="border-t border-slate-200 pt-5">
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
                              <div className="text-[10px]">
                                {chainIdToDisplayName(w.chain_id)}
                              </div>
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleUnbindWallet(
                                      w.address,
                                    )
                                  }
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
                                setSelectedInjectedProviderKey(
                                  event.target.value,
                                )
                              }
                              disabled={paymentBusy}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-xs text-slate-900 outline-none transition-all hover:bg-slate-50 disabled:opacity-60"
                            >
                              {injectedProviderOptions.map(
                                (option) => (
                                  <option
                                    key={option.key}
                                    value={option.key}
                                    className="bg-white text-slate-900"
                                  >
                                    {option.label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                        )}
                        <button
                          onClick={() => {
                            setProviderMode("auto");
                            void connectAndBindWallet("auto");
                          }}
                          disabled={
                            paymentBusy || !isAuthenticated
                          }
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-60"
                        >
                          <PlusIcon className="w-4 h-4" />{" "}
                          {copy.bindExt}
                        </button>
                        <button
                          onClick={() => {
                            setProviderMode("walletconnect");
                            void connectAndBindWallet(
                              "walletconnect",
                            );
                          }}
                          disabled={
                            paymentBusy ||
                            !isAuthenticated ||
                            !walletConnectEnabled
                          }
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 py-3 text-xs font-bold text-cyan-700 transition-all hover:bg-cyan-100 disabled:opacity-60"
                        >
                          <CreditCard className="w-4 h-4" />{" "}
                          {copy.bindQr}
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
                            onClick={() =>
                              void createManualPaymentIntent()
                            }
                            disabled={
                              paymentBusy || !isAuthenticated
                            }
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
                                {manualPayment.token_symbol ||
                                  selectedTokenLabel}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                                {copy.paymentReceiverLabel}
                              </p>
                              <div className="mt-1 flex gap-2">
                                <code className="min-w-0 flex-1 break-all whitespace-normal rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 font-mono text-[11px] text-blue-800">
                                  {
                                    manualPayment.receiver_address
                                  }
                                </code>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopy(
                                      manualPayment.receiver_address,
                                    )
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
                                  setManualTxHash(
                                    event.target.value,
                                  );
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
                                  {copy.verifying}
                                </p>
                              ) : txValidation.checked &&
                                txValidation.valid ? (
                                <p className="mt-1 text-[10px] text-emerald-700">
                                  {copy.verifyAddressMatch}
                                </p>
                              ) : txValidation.checked &&
                                txValidation.valid ===
                                  false ? (
                                <p className="mt-1 text-[10px] text-red-700">
                                  {txValidation.reason ===
                                  "tx_not_mined"
                                    ? copy.verifyTxNotMined
                                    : txValidation.reason ===
                                        "receiver_mismatch"
                                      ? copy
                                          .verifyAddressMismatch
                                      : txValidation.reason ===
                                          "amount_insufficient"
                                        ? copy
                                            .verifyAmountLow
                                        : txValidation.reason ===
                                            "tx_reverted"
                                          ? copy
                                              .verifyTxReverted
                                          : txValidation.detail ||
                                            copy.verifyFailed +
                                              (txValidation.reason ||
                                                copy
                                                  .verifyUnknown)}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                void submitManualPaymentTx()
                              }
                              disabled={
                                paymentBusy ||
                                !(txValidation.checked &&
                                  txValidation.valid === true)
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
        copy.footerEngine
      </footer>
    </div>
  );
}
