"use client";

import clsx from "clsx";
import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import { LogIn, UserRound } from "lucide-react";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import type { Locale } from "@/lib/i18n";

export type ScanTerminalContentView = "city-list" | "analysis";

type ThemeMode = "dark" | "light";

export function ScanTerminalLoadingScreen({
  isEn,
  rootClassName,
  themeMode,
  userLocalTime,
}: {
  isEn: boolean;
  rootClassName: string;
  themeMode: ThemeMode;
  userLocalTime: string;
}) {
  return (
    <div className={rootClassName}>
      <div className={clsx("scan-terminal", themeMode === "light" && "light")}>
        <main className="scan-data-grid">
          <div className="scan-topbar">
            <div className="scan-topbar-title">
              <strong>
                {isEn ? "AI Weather Decision Terminal" : "AI 天气交易决策台"}
              </strong>
              <span>
                {isEn
                  ? "Loading paid decision cards, city evidence, and market signals"
                  : "正在加载付费决策卡、城市证据和市场信号"}
              </span>
            </div>
            <div className="scan-topbar-actions">
              <span className="scan-topbar-time">{userLocalTime}</span>
            </div>
          </div>
          <div className="scan-loading-state">
            <LoadingSignal
              title={
                isEn ? "Preparing decision workspace" : "正在准备决策工作台"
              }
              description={
                isEn
                  ? "Checking access, city context and today's tradable weather windows."
                  : "正在检查权限、城市上下文和今日可交易天气窗口。"
              }
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export function ScanTerminalTopBar({
  accountHref,
  isAuthenticated,
  isEn,
  isPro,
  locale,
  onOpenScanPaywall,
  setThemeMode,
  themeMode,
  toggleLocale,
  userLocalTime,
}: {
  accountHref: string;
  isAuthenticated: boolean;
  isEn: boolean;
  isPro: boolean;
  locale: Locale;
  onOpenScanPaywall: () => void;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
  toggleLocale: () => void;
  userLocalTime: string;
}) {
  return (
    <div className="scan-topbar">
      <div className="scan-topbar-title">
        <strong>
          {isEn ? "AI Weather Decision Terminal" : "AI 天气交易决策台"}
        </strong>
        <span>
          {isEn
            ? "Paid workspace for city evidence, model signals, and weather-market decisions"
            : "面向付费用户的城市证据、模型信号与天气市场决策工作区"}
        </span>
      </div>
      <div className="scan-topbar-actions">
        <button
          type="button"
          className="scan-locale-switch"
          aria-label={isEn ? "Switch to Chinese" : "切换到英文"}
          title={isEn ? "Switch to Chinese" : "切换到英文"}
          onClick={toggleLocale}
        >
          <span className={clsx(locale === "zh-CN" && "active")}>中文</span>
          <span className={clsx(locale === "en-US" && "active")}>EN</span>
        </button>
        <span className="scan-topbar-time">{userLocalTime}</span>
        {isPro ? null : isAuthenticated ? (
          <button
            type="button"
            className="scan-primary-button"
            onClick={onOpenScanPaywall}
          >
            <UserRound size={14} />
            {isEn ? "Upgrade Pro" : "升级 Pro"}
          </button>
        ) : (
          <Link href={accountHref} className="scan-primary-button">
            <LogIn size={14} />
            {isEn ? "Sign in" : "登录"}
          </Link>
        )}

        {isAuthenticated ? (
          <Link
            href={accountHref}
            className="scan-account-button"
            aria-label={isEn ? "Account" : "账户"}
            title={isEn ? "Account" : "账户"}
          >
            <UserRound size={15} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function ScanPaywallModal({
  isEn,
  onClose,
}: {
  isEn: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? "Unlock market scan" : "解锁市场扫描"}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <ProFeaturePaywall feature="scan" onClose={onClose} />
    </div>
  );
}
