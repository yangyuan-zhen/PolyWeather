"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  scanTerminalClient,
  toRemoteError,
  toRemoteLoading,
  toRemoteSuccess,
  type RemoteData,
} from "@/components/dashboard/scan-terminal/scan-terminal-client";
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
  const [scanRemote, setScanRemote] = useState<RemoteData<ScanTerminalResponse>>({
    status: "idle",
  });
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
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
      scanAbortRef.current?.abort();
      const controller = new AbortController();
      scanAbortRef.current = controller;
      if (forceRefresh) {
        lastForcedScanRefreshAtRef.current = Date.now();
      }
      if (showLoading) {
        scanLoadingRef.current = true;
        setScanLoading(true);
        setScanRemote((current) => toRemoteLoading(current));
      }
      setScanError(null);
      try {
        const payload = await scanTerminalClient.getTerminal({
          forceRefresh,
          signal: controller.signal,
        });
        if (requestSeq !== scanRequestSeqRef.current) return;
        setTerminalData(payload);
        setScanRemote(toRemoteSuccess(payload));
        setScanError(null);
      } catch (error) {
        if (controller.signal.aborted || requestSeq !== scanRequestSeqRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setScanError(message);
        setScanRemote((current) => toRemoteError(error, current));
      } finally {
        if (scanAbortRef.current === controller) {
          scanAbortRef.current = null;
        }
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
      setScanRemote({ status: "idle" });
      return;
    }
    void fetchScanTerminal({ forceRefresh: false, showLoading: true });
  }, [fetchScanTerminal, isPro, proAccessLoading]);

  useEffect(() => {
    return () => {
      scanAbortRef.current?.abort();
    };
  }, []);

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
    scanRemote,
    terminalData,
  };
}
