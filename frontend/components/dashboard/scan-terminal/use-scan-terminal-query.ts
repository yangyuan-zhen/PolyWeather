"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildBrowserBackendHeaders,
  fetchBackendApi,
} from "@/lib/backend-api";
import type { ScanTerminalResponse } from "@/lib/dashboard-types";

const SCAN_TERMINAL_AUTO_REFRESH_MS = 10 * 60_000;
const SCAN_TERMINAL_MANUAL_REFRESH_COOLDOWN_MS = 2 * 60_000;

export function useScanTerminalQuery({
  isPro,
  proAccessLoading,
}: {
  isPro: boolean;
  proAccessLoading: boolean;
}) {
  const [terminalData, setTerminalData] = useState<ScanTerminalResponse | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanRequestSeqRef = useRef(0);
  const scanLoadingRef = useRef(false);
  const lastForcedScanRefreshAtRef = useRef(0);

  const fetchScanTerminal = useCallback(
    async ({
      forceRefresh = false,
      showLoading = false,
    }: {
      forceRefresh?: boolean;
      showLoading?: boolean;
    } = {}) => {
      if (proAccessLoading || !isPro) return;
      const requestSeq = ++scanRequestSeqRef.current;
      const controller = new AbortController();
      if (forceRefresh) {
        lastForcedScanRefreshAtRef.current = Date.now();
      }
      if (showLoading) {
        scanLoadingRef.current = true;
        setScanLoading(true);
      }
      setScanError(null);
      const params = new URLSearchParams({
        scan_mode: "tradable",
        min_price: "0.05",
        max_price: "0.95",
        min_edge_pct: "2",
        min_liquidity: "500",
        market_type: "maxtemp",
        time_range: "today",
        limit: "36",
        force_refresh: String(forceRefresh),
      });
      if (forceRefresh) {
        params.set("_ts", String(Date.now()));
      }
      try {
        const headers = await buildBrowserBackendHeaders({
          Accept: "application/json",
        });
        const response = await fetchBackendApi(`/api/scan/terminal?${params.toString()}`, {
          cache: "no-store",
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          let message = `HTTP ${response.status}`;
          try {
            const payload = await response.json();
            message = String(payload?.error || payload?.detail || message);
          } catch {
            // Keep HTTP status message.
          }
          throw new Error(message);
        }
        const payload = (await response.json()) as ScanTerminalResponse;
        if (requestSeq !== scanRequestSeqRef.current) return;
        setTerminalData(payload);
        setScanError(null);
      } catch (error) {
        if (controller.signal.aborted || requestSeq !== scanRequestSeqRef.current) return;
        setScanError(error instanceof Error ? error.message : String(error));
      } finally {
        if (showLoading) {
          scanLoadingRef.current = false;
          setScanLoading(false);
        }
      }
    },
    [isPro, proAccessLoading],
  );

  useEffect(() => {
    if (proAccessLoading) return;
    if (!isPro) {
      scanLoadingRef.current = false;
      setScanLoading(false);
      setScanError(null);
      setTerminalData(null);
      return;
    }
    void fetchScanTerminal({ forceRefresh: false, showLoading: true });
  }, [fetchScanTerminal, isPro, proAccessLoading]);

  const refreshScanTerminalManually = useCallback(() => {
    const now = Date.now();
    const lastForced = lastForcedScanRefreshAtRef.current;
    const withinCooldown =
      lastForced > 0 &&
      now - lastForced < SCAN_TERMINAL_MANUAL_REFRESH_COOLDOWN_MS &&
      terminalData;
    if (withinCooldown) {
      setScanError(null);
      return;
    }
    void fetchScanTerminal({ forceRefresh: true, showLoading: true });
  }, [fetchScanTerminal, terminalData]);

  useEffect(() => {
    if (proAccessLoading || !isPro) return;
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      if (scanLoadingRef.current) return;
      void fetchScanTerminal({ forceRefresh: true, showLoading: false });
    }, SCAN_TERMINAL_AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchScanTerminal, isPro, proAccessLoading]);

  return {
    refreshScanTerminalManually,
    scanError,
    scanLoading,
    terminalData,
  };
}
