"use client";

import clsx from "clsx";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";

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
                {isEn ? "PolyWeather Terminal" : "PolyWeather 交易决策台"}
              </strong>
              <span>
                {isEn
                  ? "Loading decision cards, city evidence, and market signals"
                  : "正在加载决策卡、城市证据和市场信号"}
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
