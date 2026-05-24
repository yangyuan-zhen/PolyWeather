"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  LogIn,
  UserRound,
  RotateCw,
  BookOpen,
  MoreHorizontal,
  CloudSun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useDashboardStore, useProAccess } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";

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

export function HeaderBar({
  refreshAction,
  refreshSpinning,
}: {
  refreshAction?: () => void | Promise<void>;
  refreshSpinning?: boolean;
}) {
  const store = useDashboardStore();
  const { proAccess } = useProAccess();
  const { locale, t, toggleLocale } = useI18n();
  const pathname = usePathname();
  const isAuthenticated = proAccess.authenticated;
  const docsHref = "/docs/intro";
  const docsActive = pathname?.startsWith("/docs");
  const navItems = [
    {
      href: "/",
      label: locale === "en-US" ? "Dashboard" : "总览",
      active: pathname === "/",
    },
  ];
  const isRefreshing = refreshSpinning ?? store.loadingState.refresh;
  const handleRefresh = () => {
    if (refreshAction) {
      return void refreshAction();
    }
    return void store.refreshAll();
  };

  const accountHref = isAuthenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const accountAria = isAuthenticated
    ? t("header.accountAria")
    : t("header.signInAria");
  const effectiveExpiry = proAccess.subscriptionActive
    ? proAccess.subscriptionTotalExpiresAt ||
      proAccess.subscriptionExpiresAt
    : proAccess.subscriptionExpiresAt;
  const expiryInfo = parseExpiryInfo(effectiveExpiry);
  const hasQueuedExtension = Boolean(
    proAccess.subscriptionActive &&
      proAccess.subscriptionQueuedDays > 0,
  );
  const showRenewReminder =
    isAuthenticated &&
    !proAccess.loading &&
    !hasQueuedExtension &&
    ((proAccess.subscriptionActive &&
      expiryInfo &&
      expiryInfo.daysLeft <= 3) ||
      (!proAccess.subscriptionActive && Boolean(expiryInfo)));
  const renewReminderLabel = !showRenewReminder
    ? ""
    : !proAccess.subscriptionActive
      ? locale === "en-US"
        ? "Pro expired"
        : "Pro 已到期"
      : locale === "en-US"
        ? `Pro ${Math.max(expiryInfo?.daysLeft || 0, 0)}d left`
        : `Pro 还剩 ${Math.max(expiryInfo?.daysLeft || 0, 0)} 天`;


  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark bg-blue-600 !border-transparent flex items-center justify-center text-white" aria-hidden="true">
          <CloudSun size={18} />
        </span>
        <h1>PolyWeather</h1>
        <span className="subtitle">{t("header.subtitle")}</span>
      </div>

      <nav
        className="header-nav"
        aria-label={locale === "en-US" ? "Primary" : "主导航"}
      >
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx("header-nav-link", item.active && "active")}
          >
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="header-right">
        <button
          type="button"
          className="locale-switch"
          aria-label={locale === "en-US" ? "Switch to Chinese" : "切换到英文"}
          title={locale === "en-US" ? "Switch to Chinese" : "切换到英文"}
          onClick={toggleLocale}
        >
          <span className={clsx(locale === "zh-CN" && "active")}>中文</span>
          <span className={clsx(locale === "en-US" && "active")}>EN</span>
        </button>

        <div className="live-badge" id="liveBadge">
          <span className="pulse-dot" />
          <span>{t("header.live")}</span>
        </div>

        <button
          type="button"
          className={clsx("refresh-btn", isRefreshing && "spinning")}
          title={t("header.refreshAria")}
          aria-label={t("header.refreshAria")}
          onClick={handleRefresh}
        >
          <RotateCw size={16} strokeWidth={2} />
        </button>


        <Link
          href={docsHref}
          className={clsx("header-utility-btn", docsActive && "active")}
          title={t("header.docsAria")}
          aria-label={t("header.docsAria")}
        >
          <BookOpen size={14} strokeWidth={2} />
          <span>{t("header.docs")}</span>
        </Link>

        <Link
          href={accountHref}
          className="header-utility-btn"
          title={accountAria}
          aria-label={accountAria}
        >
          {isAuthenticated ? <UserRound size={14} /> : <LogIn size={14} />}
        </Link>

        <button
          type="button"
          className="header-utility-btn more"
          aria-label={locale === "en-US" ? "More actions" : "更多操作"}
          title={locale === "en-US" ? "More actions" : "更多操作"}
        >
          <MoreHorizontal size={16} strokeWidth={2} />
        </button>

        {showRenewReminder ? (
          <Link
            href="/account"
            className={clsx(
              "account-renew-badge",
              !proAccess.subscriptionActive && "expired",
            )}
            title={renewReminderLabel}
            aria-label={renewReminderLabel}
          >
            <span>{renewReminderLabel}</span>
          </Link>
        ) : null}
      </div>
    </header>
  );
}

