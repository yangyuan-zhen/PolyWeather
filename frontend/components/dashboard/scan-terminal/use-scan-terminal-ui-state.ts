"use client";

import { useEffect, useState } from "react";
import { formatUserLocalTime } from "@/components/dashboard/scan-terminal/decision-utils";

export type ThemeMode = "dark" | "light";

export function useUserLocalClock() {
  const [userLocalTime, setUserLocalTime] = useState("--");

  useEffect(() => {
    setUserLocalTime(formatUserLocalTime());
    const intervalId = window.setInterval(() => {
      setUserLocalTime(formatUserLocalTime());
    }, 10_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return userLocalTime;
}

export function useScanTerminalTheme() {
  const [themeMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("light");
    root.classList.remove("dark");
  }, []);

  return { setThemeMode: () => {}, themeMode };
}
