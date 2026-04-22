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
  Moon,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useDashboardStore } from "@/hooks/useDashboardStore";
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
  const { locale, t, toggleLocale } = useI18n();
  const pathname = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const isAuthenticated = store.proAccess.authenticated;
  const docsHref = "/docs/intro";
  const docsActive = pathname?.startsWith("/docs");
  const navItems = [
    {
      href: "/",
      label: locale === "en-US" ? "Dashboard" : "总览",
      active: pathname === "/",
    },
    {
      href: "/docs/intraday-signal",
      label: locale === "en-US" ? "Markets" : "市场",
      active: pathname?.startsWith("/docs/intraday-signal"),
    },
    {
      href: "/docs/model-stack-deb",
      label: locale === "en-US" ? "Analytics" : "分析",
      active: pathname?.startsWith("/docs/model-stack-deb"),
    },
    {
      href: "/docs/history-review",
      label: locale === "en-US" ? "History" : "历史",
      active: pathname?.startsWith("/docs/history-review"),
    },
    {
      href: "/docs/alert-playbook",
      label: locale === "en-US" ? "Alerts" : "预警",
      active: pathname?.startsWith("/docs/alert-playbook"),
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
  const effectiveExpiry = store.proAccess.subscriptionActive
    ? store.proAccess.subscriptionTotalExpiresAt ||
      store.proAccess.subscriptionExpiresAt
    : store.proAccess.subscriptionExpiresAt;
  const expiryInfo = parseExpiryInfo(effectiveExpiry);
  const hasQueuedExtension = Boolean(
    store.proAccess.subscriptionActive &&
      store.proAccess.subscriptionQueuedDays > 0,
  );
  const isTrialPlan = /trial/i.test(
    String(store.proAccess.subscriptionPlanCode || ""),
  );
  const showRenewReminder =
    isAuthenticated &&
    !store.proAccess.loading &&
    !hasQueuedExtension &&
    ((store.proAccess.subscriptionActive &&
      expiryInfo &&
      expiryInfo.daysLeft <= 3) ||
      (!store.proAccess.subscriptionActive && Boolean(expiryInfo)));
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

  useEffect(() => {
    const savedTheme =
      typeof window !== "undefined"
        ? window.localStorage.getItem("polyweather_theme")
        : null;
    const nextTheme = savedTheme === "light" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.classList.toggle("light", nextTheme === "light");
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.classList.toggle("light", nextTheme === "light");
    window.localStorage.setItem("polyweather_theme", nextTheme);
  };

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Image src="/favicon-32x32.png" alt="" width={24} height={24} priority />
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

        <button
          type="button"
          className="header-utility-btn"
          aria-label={theme === "dark" ? "切换到明亮模式" : "切换到暗黑模式"}
          title={theme === "dark" ? "明亮模式" : "暗黑模式"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? (
            <Sun size={15} strokeWidth={2} />
          ) : (
            <Moon size={15} strokeWidth={2} />
          )}
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
              !store.proAccess.subscriptionActive && "expired",
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
