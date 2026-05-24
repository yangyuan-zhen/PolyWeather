"use client";

import { useEffect, useState } from "react";

function relativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "刚刚";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

export function useRelativeTime(isoString: string | null | undefined): string {
  const [tick, setTick] = useState(0);

  const date = isoString ? new Date(isoString) : null;

  useEffect(() => {
    if (!date) return;
    const canUseInterval =
      typeof window !== "undefined" &&
      typeof window.setInterval === "function" &&
      typeof window.clearInterval === "function";
    const canUseVisibility =
      typeof document !== "undefined" &&
      typeof document.addEventListener === "function" &&
      typeof document.removeEventListener === "function";
    const interval = canUseInterval
      ? window.setInterval(() => setTick((n) => n + 1), 30_000)
      : null;
    const onVisible = () => setTick((n) => n + 1);
    if (canUseVisibility) {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      if (interval != null) window.clearInterval(interval);
      if (canUseVisibility) {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [date]);

  if (!date || isNaN(date.getTime())) return "";
  return relativeTime(date, new Date());
}
