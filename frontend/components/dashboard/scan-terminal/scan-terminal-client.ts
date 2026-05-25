"use client";

import { extractStreamingAirportRead } from "@/components/dashboard/scan-terminal/ai-city-stream";
import {
  normalizeCityMarketScanPayload,
  type CityMarketScanApiPayload,
} from "@/components/dashboard/scan-terminal/market-scan-state";
import type { AiCityForecastPayload } from "@/components/dashboard/scan-terminal/types";
import {
  buildBrowserBackendHeaders,
  fetchBackendApi,
} from "@/lib/backend-api";
import type {
  CityDetail,
  MarketScan,
  ScanTerminalResponse,
} from "@/lib/dashboard-types";

export type RemoteData<T> =
  | { status: "idle" }
  | { status: "loading"; previous?: T }
  | { status: "success"; data: T; freshAt: number }
  | { status: "error"; error: string; previous?: T };

export type AiCityStreamProgress = {
  stage?: string | null;
  message_en?: string | null;
  message_zh?: string | null;
  final_judgment_en?: string | null;
  final_judgment_zh?: string | null;
  metar_read_en?: string | null;
  metar_read_zh?: string | null;
  model_cluster_note_en?: string | null;
  model_cluster_note_zh?: string | null;
  raw_length?: number | null;
  predicted_max?: number | null;
  range_low?: number | null;
  range_high?: number | null;
  confidence?: string | null;
  unit?: string | null;
};

export const scanTerminalQueryPolicy = {
  autoRefreshMs: 10 * 60_000,
  manualForceRefreshCooldownMs: 2 * 60_000,
} as const;

type AiCityStreamEvent = {
  data: Record<string, unknown>;
  event: string;
};

type TerminalQueryOptions = {
  forceRefresh?: boolean;
  signal?: AbortSignal;
  tradingRegion?: string;
};

type CityDetailQueryOptions = {
  depth?: "panel" | "market" | "nearby" | "full";
  forceRefresh?: boolean;
  marketSlug?: string | null;
  signal?: AbortSignal;
  targetDate?: string | null;
};

type MarketScanQueryOptions = CityDetailQueryOptions & {
  lite?: boolean;
};

type AiCityReadOptions = {
  city: string;
  forceRefresh?: boolean;
  locale: string;
  requestKey?: string;
  onProgress?: (progress: AiCityStreamProgress) => void;
  signal?: AbortSignal;
};

const AI_CITY_READ_MAX_CONCURRENT_STREAMS = 4;
const pendingAiCityReadRequests = new Map<string, Promise<AiCityForecastPayload>>();
const queuedAiCityReadTasks: Array<() => void> = [];
let activeAiCityReadStreams = 0;

function getRemoteError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readPreviousRemoteData<T>(remote: RemoteData<T>): T | undefined {
  if (remote.status === "success") return remote.data;
  if ("previous" in remote) return remote.previous;
  return undefined;
}

export function toRemoteLoading<T>(current: RemoteData<T>): RemoteData<T> {
  return {
    status: "loading",
    previous: readPreviousRemoteData(current),
  };
}

export function toRemoteSuccess<T>(data: T): RemoteData<T> {
  return {
    data,
    freshAt: Date.now(),
    status: "success",
  };
}

export function toRemoteError<T>(
  error: unknown,
  current: RemoteData<T>,
): RemoteData<T> {
  return {
    error: getRemoteError(error),
    previous: readPreviousRemoteData(current),
    status: "error",
  };
}

export function shouldSkipManualTerminalRefresh({
  hasCurrentData,
  lastForcedRefreshAt,
  now = Date.now(),
}: {
  hasCurrentData: boolean;
  lastForcedRefreshAt: number;
  now?: number;
}) {
  return (
    hasCurrentData &&
    lastForcedRefreshAt > 0 &&
    now - lastForcedRefreshAt < scanTerminalQueryPolicy.manualForceRefreshCooldownMs
  );
}

export function shouldRunAutoTerminalRefresh({
  documentHidden,
  isLoading,
}: {
  documentHidden: boolean;
  isLoading: boolean;
}) {
  return !documentHidden && !isLoading;
}

async function readJsonOrThrow<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchBackendApi(path, init);
  if (response.ok) return response.json() as Promise<T>;

  let message = `HTTP ${response.status}`;
  try {
    const payload = await response.json();
    message = String(payload?.error || payload?.detail || message);
  } catch {
    try {
      const raw = await response.text();
      message = raw ? `${message} · ${raw.slice(0, 240)}` : message;
    } catch {
      // Keep HTTP status message.
    }
  }
  throw new Error(message);
}

function parseAiCityStreamBlock(block: string): AiCityStreamEvent | null {
  const eventLines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  let event = "message";
  const dataLines: string[] = [];
  eventLines.forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || event;
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  });
  if (!dataLines.length) return null;
  try {
    const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    return { data, event };
  } catch {
    return null;
  }
}

async function readAiCityForecastStream(
  response: Response,
  locale: string,
  onProgress?: (progress: AiCityStreamProgress) => void,
) {
  if (!response.body) {
    return response.json() as Promise<AiCityForecastPayload>;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedRaw = "";
  let finalPayload: AiCityForecastPayload | null = null;

  const consumeBlock = (block: string) => {
    const parsed = parseAiCityStreamBlock(block);
    if (!parsed) return;
    const { data, event } = parsed;
    if (event === "final") {
      finalPayload = data as AiCityForecastPayload;
      return;
    }
    if (event === "progress" || event === "preview") {
      onProgress?.(data as AiCityStreamProgress);
      return;
    }
    if (event !== "delta") return;

    const content = String(data.content || "");
    const rawLength = Number(data.raw_length);
    if (content) {
      accumulatedRaw += content;
    }
    const streamingAirportRead = extractStreamingAirportRead(accumulatedRaw, locale);
    const progress: AiCityStreamProgress = {
      raw_length: Number.isFinite(rawLength) ? rawLength : null,
    };
    if (streamingAirportRead) {
      if (locale === "en-US") {
        progress.metar_read_en = streamingAirportRead;
      } else {
        progress.metar_read_zh = streamingAirportRead;
      }
    }
    onProgress?.(progress);
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach(consumeBlock);
    if (done) break;
  }
  if (buffer.trim()) {
    consumeBlock(buffer);
  }
  if (!finalPayload) {
    throw new Error("AI stream ended before final payload");
  }
  return finalPayload;
}

async function getTerminal({
  forceRefresh = false,
  signal,
  tradingRegion,
}: TerminalQueryOptions = {}) {
  const params = new URLSearchParams({
    scan_mode: "tradable",
    min_price: "0.05",
    max_price: "0.95",
    min_edge_pct: "2",
    min_liquidity: "500",
    market_type: "maxtemp",
    time_range: "today",
    limit: "180",
    force_refresh: String(forceRefresh),
    skip_polymarket: "true",
  });
  if (tradingRegion && tradingRegion !== "all") {
    params.set("trading_region", tradingRegion);
  }
  if (forceRefresh) {
    params.set("_ts", String(Date.now()));
  }
  const headers = await buildBrowserBackendHeaders({ Accept: "application/json" });
  return readJsonOrThrow<ScanTerminalResponse>(
    `/api/scan/terminal?${params.toString()}`,
    {
      cache: "no-store",
      headers,
      signal,
    },
  );
}

async function getCityDetail(city: string, options: CityDetailQueryOptions = {}) {
  const params = new URLSearchParams({
    depth: options.depth || "full",
    force_refresh: String(options.forceRefresh ?? false),
  });
  if (options.marketSlug) params.set("market_slug", options.marketSlug);
  if (options.targetDate) params.set("target_date", options.targetDate);
  const headers = await buildBrowserBackendHeaders({ Accept: "application/json" });
  return readJsonOrThrow<CityDetail>(
    `/api/city/${encodeURIComponent(city)}/detail?${params.toString()}`,
    {
      cache: "no-store",
      headers,
      signal: options.signal,
    },
  );
}

async function getMarketScan(city: string, options: MarketScanQueryOptions = {}) {
  const params = new URLSearchParams({
    force_refresh: String(options.forceRefresh ?? false),
  });
  if (options.targetDate) params.set("target_date", options.targetDate);
  if (options.marketSlug) params.set("market_slug", options.marketSlug);
  if (options.lite != null) params.set("lite", String(options.lite));
  const headers = await buildBrowserBackendHeaders({ Accept: "application/json" });
  const payload = await readJsonOrThrow<CityMarketScanApiPayload>(
    `/api/city/${encodeURIComponent(city)}/market-scan?${params.toString()}`,
    {
      cache: "no-store",
      headers,
      signal: options.signal,
    },
  );
  return (
    normalizeCityMarketScanPayload(payload) ?? {
      available: false,
      reason: "No market scan payload returned.",
    }
  );
}

function runQueuedAiCityReadTask<T>(task: () => Promise<T>, onQueued?: () => void) {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeAiCityReadStreams += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeAiCityReadStreams = Math.max(0, activeAiCityReadStreams - 1);
          const next = queuedAiCityReadTasks.pop();
          if (next) next();
        });
    };
    if (activeAiCityReadStreams < AI_CITY_READ_MAX_CONCURRENT_STREAMS) {
      run();
    } else {
      onQueued?.();
      queuedAiCityReadTasks.unshift(run);
    }
  });
}

async function streamAiCityReadRequest({
  city,
  forceRefresh = false,
  locale,
  onProgress,
  signal,
}: Omit<AiCityReadOptions, "requestKey">) {
  const headers = await buildBrowserBackendHeaders({
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  });
  const response = await fetchBackendApi("/api/scan/terminal/ai-city/stream", {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify({
      city,
      force_refresh: forceRefresh,
      locale,
    }),
    signal,
  });
  if (!response.ok) {
    let detailMessage = "";
    try {
      const raw = await response.text();
      const errorPayload = JSON.parse(raw);
      const message = String(errorPayload?.error || "").trim();
      const rawDetail = String(errorPayload?.detail || "").trim();
      const elapsed = Number(errorPayload?.elapsed_ms);
      const timeout = Number(errorPayload?.timeout_ms);
      detailMessage = [
        message,
        rawDetail,
        Number.isFinite(elapsed) && Number.isFinite(timeout)
          ? `elapsed ${Math.round(elapsed / 1000)}s / timeout ${Math.round(timeout / 1000)}s`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
    } catch {
      detailMessage = "";
    }
    throw new Error(
      detailMessage
        ? `HTTP ${response.status} · ${detailMessage}`
        : `HTTP ${response.status}`,
    );
  }
  return readAiCityForecastStream(response, locale, onProgress);
}

function streamAiCityRead(options: AiCityReadOptions) {
  const pendingKey = options.requestKey || "";
  const pending = pendingKey ? pendingAiCityReadRequests.get(pendingKey) : null;
  if (pending) return pending;

  const request = runQueuedAiCityReadTask(
    () => streamAiCityReadRequest(options),
    () => {
      options.onProgress?.({
        stage: "queued",
        message_en:
          "AI observation read is queued behind the cities already streaming...",
        message_zh: "AI 观测解读已排队，正在等待前面的城市完成流式生成…",
      });
    },
  ).finally(() => {
    if (pendingKey) pendingAiCityReadRequests.delete(pendingKey);
  });

  if (pendingKey) {
    pendingAiCityReadRequests.set(pendingKey, request);
  }
  return request;
}

export const scanTerminalClient = {
  getCityDetail,
  getMarketScan,
  getTerminal,
  streamAiCityRead,
};
