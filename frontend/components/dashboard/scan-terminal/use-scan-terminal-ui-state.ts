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
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains("light");
    const hadDark = root.classList.contains("dark");
    root.classList.toggle("light", themeMode === "light");
    root.classList.toggle("dark", themeMode === "dark");
    return () => {
      root.classList.toggle("light", hadLight);
      root.classList.toggle("dark", hadDark);
    };
  }, [themeMode]);

  useEffect(() => {
    const stored = window.localStorage.getItem("polyweather_scan_theme");
    if (stored === "light") {
      setThemeMode("light");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("polyweather_scan_theme", themeMode);
  }, [themeMode]);

  return { setThemeMode, themeMode };
}
