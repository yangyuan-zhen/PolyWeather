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
      <div className={clsx("flex h-screen w-full items-center justify-center bg-[#e9edf3]", themeMode === "light" && "light")}>
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
    </div>
  );
}
