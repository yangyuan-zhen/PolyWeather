"use client";

import clsx from "clsx";
import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import {
  LogIn,
  MessageCircle,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import type { Locale } from "@/lib/i18n";

export type ScanTerminalContentView = "analysis" | "map" | "monitor" | "runway";

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
                  ? "Start from the map, then open city cards to verify weather evidence"
                  : "从地图选城市，再打开决策卡验证天气证据"}
              </span>
            </div>
            <div className="scan-topbar-actions">
              <span className="scan-topbar-time">{userLocalTime}</span>
            </div>
          </div>
          <div className="scan-loading-state">
            <LoadingSignal
              title={isEn ? "Preparing decision workspace" : "正在准备决策工作台"}
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
        <strong>{isEn ? "AI Weather Decision Terminal" : "AI 天气交易决策台"}</strong>
        <span>
          {isEn
            ? "Start from the map, then open city cards to verify weather evidence"
            : "从地图选城市，再打开决策卡验证天气证据"}
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
        <button
          type="button"
          className="scan-theme-button"
          aria-label={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
          title={themeMode === "light" ? "切换到暗色模式" : "切换到明亮模式"}
          onClick={() =>
            setThemeMode((current) => (current === "light" ? "dark" : "light"))
          }
        >
          {themeMode === "light" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
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
        <a
          href="https://t.me/+nMG7SjziUKYyZmM1"
          target="_blank"
          rel="noopener noreferrer"
          className="scan-account-button"
          aria-label={isEn ? "Feedback" : "反馈"}
          title={isEn ? "Join Telegram for feedback" : "加入 Telegram 反馈"}
        >
          <MessageCircle size={15} />
        </a>
      </div>
    </div>
  );
}

export function ScanUpgradeAnnouncement({
  isEn,
  onDismiss,
}: {
  isEn: boolean;
  onDismiss: () => void;
}) {
  return (
    <section
      className="scan-upgrade-announcement"
      aria-label={isEn ? "Upgrade announcement" : "升级公告"}
    >
      <div className="scan-upgrade-announcement-copy">
        <span>{isEn ? "v1.5.6 upgrade" : "v1.5.6 升级公告"}</span>
        <strong>
          {isEn
            ? "Scan terminal is upgraded to v1.5.6"
            : "决策终端已升级到 v1.5.6"}
        </strong>
        <p>
          {isEn
            ? "City decision cards have been redesigned with a compact hero layout and consistent DEB data source. Sticky headers are removed for smoother scrolling."
            : "城市决策卡 hero 布局重新设计，三指标并列对比更直观；DEB 数据源统一不再出现不一致；去除顶部固定效果滚动更流畅。"}
        </p>
      </div>
      <ul>
        <li>{isEn ? "Redesigned decision card hero" : "重设计城市决策卡 hero 布局"}</li>
        <li>{isEn ? "Unified DEB data source" : "统一 DEB 数据源"}</li>
        <li>{isEn ? "Light theme coverage" : "亮色主题补全覆盖"}</li>
        <li>{isEn ? "HKO observatory AI read" : "香港天文台观测 AI 解读"}</li>
        <li>{isEn ? "Smoother scrolling experience" : "滚动体验优化"}</li>
      </ul>
      <button
        type="button"
        className="scan-announcement-dismiss"
        aria-label={isEn ? "Dismiss" : "关闭"}
        onClick={onDismiss}
      >
        ✕
      </button>
    </section>
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
