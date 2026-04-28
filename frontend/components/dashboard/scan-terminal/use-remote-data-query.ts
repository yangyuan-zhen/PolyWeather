"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  toRemoteError,
  toRemoteLoading,
  toRemoteSuccess,
  type RemoteData,
} from "@/components/dashboard/scan-terminal/scan-terminal-client";

type RunRemoteQueryOptions<T> = {
  onSuccess?: (data: T) => void;
  request: (signal: AbortSignal) => Promise<T>;
  showLoading?: boolean;
};

export function useRemoteDataQuery<T>() {
  const [data, setData] = useState<T | null>(null);
  const [remote, setRemote] = useState<RemoteData<T>>({ status: "idle" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const loadingRef = useRef(false);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    requestSeqRef.current += 1;
    abort();
    loadingRef.current = false;
    setLoading(false);
    setError(null);
    setData(null);
    setRemote({ status: "idle" });
  }, [abort]);

  const setSuccess = useCallback(
    (nextData: T) => {
      requestSeqRef.current += 1;
      abort();
      loadingRef.current = false;
      setLoading(false);
      setError(null);
      setData(nextData);
      setRemote(toRemoteSuccess(nextData));
    },
    [abort],
  );

  const run = useCallback(
    async ({
      onSuccess,
      request,
      showLoading = false,
    }: RunRemoteQueryOptions<T>) => {
      const requestSeq = ++requestSeqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (showLoading) {
        loadingRef.current = true;
        setLoading(true);
        setRemote((current) => toRemoteLoading(current));
      }
      setError(null);
      try {
        const payload = await request(controller.signal);
        if (requestSeq !== requestSeqRef.current) return null;
        setData(payload);
        setRemote(toRemoteSuccess(payload));
        setError(null);
        onSuccess?.(payload);
        return payload;
      } catch (caught) {
        if (controller.signal.aborted || requestSeq !== requestSeqRef.current) {
          return null;
        }
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        setRemote((current) => toRemoteError(caught, current));
        return null;
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (showLoading) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [],
  );

  const isLoading = useCallback(() => loadingRef.current, []);

  useEffect(() => abort, [abort]);

  return {
    abort,
    data,
    error,
    isLoading,
    loading,
    remote,
    reset,
    run,
    setSuccess,
  };
}
