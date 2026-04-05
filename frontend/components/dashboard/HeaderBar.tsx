"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogIn, UserRound } from "lucide-react";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";

function parseExpiryInfo(raw?: string | null) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return null;
  const diffMs = dt.getTime() - Date.now();
  const daysLeft = Math.ceil(diffMs / 86_400_000);
  return {
    date: dt,
    daysLeft,
    expired: diffMs <= 0,
  };
}

export function HeaderBar() {
  const store = useDashboardStore();
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const supabaseReady = hasSupabasePublicEnv();
  const docsHref = "/docs/intro";
  const docsActive = pathname?.startsWith("/docs");
  const trialPromoLabel =
    locale === "en-US" ? "New users get 3-day Pro trial" : "新用户可免费体验 3 天 Pro";

  useEffect(() => {
    let mounted = true;

    if (!supabaseReady) {
      setIsAuthenticated(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setIsAuthenticated(Boolean(data.session?.user?.id));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setIsAuthenticated(Boolean(session?.user?.id));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabaseReady]);

  const accountHref = isAuthenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const accountLabel = isAuthenticated ? t("header.account") : t("header.signIn");
  const accountAria = isAuthenticated
    ? t("header.accountAria")
    : t("header.signInAria");
  const expiryInfo = parseExpiryInfo(store.proAccess.subscriptionExpiresAt);
  const isTrialPlan = /trial/i.test(
    String(store.proAccess.subscriptionPlanCode || ""),
  );
  const showRenewReminder =
    isAuthenticated &&
    !store.proAccess.loading &&
    (
      (store.proAccess.subscriptionActive &&
        expiryInfo &&
        expiryInfo.daysLeft <= 3) ||
      (!store.proAccess.subscriptionActive && Boolean(expiryInfo))
    );
  const renewReminderLabel = !showRenewReminder
    ? ""
    : !store.proAccess.subscriptionActive
      ? isTrialPlan
        ? locale === "en-US"
          ? "Trial ended"
          : "试用已结束"
        : locale === "en-US"
          ? "Pro expired"
          : "Pro 已到期"
      : isTrialPlan
        ? locale === "en-US"
          ? `Trial ${Math.max(expiryInfo?.daysLeft || 0, 0)}d left`
          : `试用剩余 ${Math.max(expiryInfo?.daysLeft || 0, 0)} 天`
        : locale === "en-US"
          ? `Pro ${Math.max(expiryInfo?.daysLeft || 0, 0)}d left`
          : `Pro 还剩 ${Math.max(expiryInfo?.daysLeft || 0, 0)} 天`;

  return (
    <header className="header">
      <div className="brand">
        <h1>PolyWeather</h1>
        <span className="subtitle">{t("header.subtitle")}</span>
      </div>

      <div className="header-right">
        <div className="lang-switch" role="group" aria-label={t("header.langAria")}>
          <button
            type="button"
            className={clsx("lang-btn", locale === "zh-CN" && "active")}
            onClick={() => setLocale("zh-CN")}
          >
            {t("header.langZh")}
          </button>
          <button
            type="button"
            className={clsx("lang-btn", locale === "en-US" && "active")}
            onClick={() => setLocale("en-US")}
          >
            {t("header.langEn")}
          </button>
        </div>

        <Link
          href={docsHref}
          className={clsx("info-btn", docsActive && "active")}
          title={t("header.docsAria")}
          aria-label={t("header.docsAria")}
        >
          {t("header.docs")}
        </Link>

        <Link
          href="/account"
          className="trial-promo-badge"
          title={trialPromoLabel}
          aria-label={trialPromoLabel}
        >
          <span>{trialPromoLabel}</span>
        </Link>

        <Link
          href={accountHref}
          className="account-btn"
          title={accountAria}
          aria-label={accountAria}
        >
          {isAuthenticated ? <UserRound size={14} /> : <LogIn size={14} />}
          <span>{accountLabel}</span>
        </Link>

        {showRenewReminder ? (
          <Link
            href="/account"
            className={clsx(
              "account-renew-badge",
              !store.proAccess.subscriptionActive && "expired",
            )}
            title={renewReminderLabel}
            aria-label={renewReminderLabel}
          >
            <span>{renewReminderLabel}</span>
          </Link>
        ) : null}

        <div className="live-badge" id="liveBadge">
          <span className="pulse-dot" />
          <span>{t("header.live")}</span>
        </div>

        <button
          type="button"
          className={clsx("refresh-btn", store.loadingState.refresh && "spinning")}
          title={t("header.refreshAria")}
          aria-label={t("header.refreshAria")}
          onClick={() => void store.refreshAll()}
        >
          ↻
        </button>
      </div>
    </header>
  );
}
