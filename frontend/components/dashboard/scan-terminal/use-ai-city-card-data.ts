"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  enqueueAiCityFetch,
  extractStreamingAirportRead,
  parseSseBlock,
} from "@/components/dashboard/scan-terminal/ai-city-stream";
import type {
  AiCityForecastPayload,
  AiCityForecastState,
} from "@/components/dashboard/scan-terminal/types";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import type { CityDetail, MarketScan } from "@/lib/dashboard-types";
import { normalizeCityKey } from "./decision-utils";

export function useAiCityForecast({
  detail,
  detailCityName,
  isEn,
  locale,
  report,
}: {
  detail: CityDetail | null;
  detailCityName: string;
  isEn: boolean;
  locale: string;
  report: string;
}) {
  const [aiForecast, setAiForecast] = useState<AiCityForecastState>({
    status: "idle",
  });
  const [aiRefreshToken, setAiRefreshToken] = useState(0);
  const aiForecastKey = useMemo(
    () =>
      detail
        ? `${normalizeCityKey(detailCityName)}:${detail.local_date || ""}:${report || ""}`
        : "",
    [detail, detailCityName, report],
  );

  useEffect(() => {
    if (!aiForecastKey) {
      setAiForecast({ status: "idle" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setAiForecast({ status: "loading", streamText: null, streamRaw: "" });
    enqueueAiCityFetch(
      () =>
        fetch("/api/scan/terminal/ai-city/stream", {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            city: detailCityName,
            force_refresh: aiRefreshToken > 0,
            locale,
          }),
        }).then(async (response) => {
          if (!response.ok) {
            let detailMessage = "";
            try {
              const errorPayload = await response.json();
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
          const contentType = response.headers.get("content-type") || "";
          if (!response.body || !contentType.includes("text/event-stream")) {
            return response.json() as Promise<AiCityForecastPayload>;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let rawStream = "";
          let finalPayload: AiCityForecastPayload | null = null;
          const handleBlock = (block: string) => {
            const message = parseSseBlock(block);
            if (!message || !message.data || typeof message.data !== "object") {
              return;
            }
            const data = message.data as Record<string, unknown>;
            if (message.event === "progress") {
              const progressText =
                String(
                  locale === "en-US" ? data.message_en || "" : data.message_zh || "",
                ).trim() || String(data.message || "").trim();
              if (progressText && !cancelled) {
                setAiForecast((current) =>
                  current.status === "loading"
                    ? { ...current, streamText: current.streamText || progressText }
                    : current,
                );
              }
            } else if (message.event === "preview") {
              const previewText =
                String(
                  locale === "en-US"
                    ? data.metar_read_en || ""
                    : data.metar_read_zh || "",
                ).trim() ||
                String(data.metar_read_zh || data.metar_read_en || "").trim() ||
                String(
                  locale === "en-US"
                    ? data.final_judgment_en || ""
                    : data.final_judgment_zh || "",
                ).trim() ||
                String(data.final_judgment_zh || data.final_judgment_en || "").trim();
              if (previewText && !cancelled) {
                setAiForecast((current) =>
                  current.status === "loading"
                    ? {
                        ...current,
                        streamText: previewText,
                      }
                    : current,
                );
              }
            } else if (message.event === "delta") {
              const content = String(data.content || "");
              if (!content) return;
              rawStream += content;
              const airportRead = extractStreamingAirportRead(rawStream, locale);
              const streamingText =
                airportRead ||
                (rawStream.trim()
                  ? isEn
                    ? "AI has started streaming; parsing the METAR read field…"
                    : "AI 已开始流式输出，正在解析机场报文字段…"
                  : "");
              if (!cancelled) {
                setAiForecast((current) =>
                  current.status === "loading"
                    ? {
                        ...current,
                        streamRaw: rawStream,
                        streamText: streamingText || current.streamText || null,
                      }
                    : current,
                );
              }
            } else if (message.event === "final") {
              finalPayload = data as AiCityForecastPayload;
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\n\n|\r\n\r\n/);
            buffer = blocks.pop() || "";
            for (const block of blocks) {
              handleBlock(block);
            }
          }
          buffer += decoder.decode();
          if (buffer.trim()) {
            handleBlock(buffer);
          }
          if (!finalPayload) {
            throw new Error("AI stream ended before final payload");
          }
          return finalPayload;
        }),
      controller.signal,
      {
        onQueued: () => {
          if (cancelled) return;
          setAiForecast((current) =>
            current.status === "loading"
              ? {
                  ...current,
                  streamText: isEn
                    ? "Waiting for the AI airport read queue..."
                    : "正在等待 AI 机场报文解读队列...",
                }
              : current,
          );
        },
        onStart: () => {
          if (cancelled) return;
          setAiForecast((current) =>
            current.status === "loading"
              ? {
                  ...current,
                  streamText: current.streamRaw
                    ? current.streamText
                    : isEn
                      ? "Connecting to DeepSeek V4-Pro for airport bulletin streaming..."
                      : "正在连接 DeepSeek V4-Pro，准备流式解读机场报文...",
                }
              : current,
          );
        },
      },
    )
      .then((payload) => {
        if (!cancelled) {
          setAiForecast({ payload, status: "ready" });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          setAiForecast({ error: String(error), status: "failed" });
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [aiForecastKey, aiRefreshToken, detailCityName, isEn, locale]);

  const refreshAiForecast = useCallback(() => {
    setAiRefreshToken((current) => current + 1);
  }, []);

  return { aiForecast, refreshAiForecast };
}

export function useCityMarketScan({
  detail,
  detailCityName,
}: {
  detail: CityDetail | null;
  detailCityName: string;
}) {
  const ensureCityMarketScan = useDashboardStore().ensureCityMarketScan;
  const [marketScan, setMarketScan] = useState<MarketScan | null>(
    detail?.market_scan || null,
  );
  const [marketStatus, setMarketStatus] = useState<
    "idle" | "loading" | "ready" | "failed"
  >(detail?.market_scan ? "ready" : "idle");

  useEffect(() => {
    if (!detail) {
      setMarketScan(null);
      setMarketStatus("idle");
      return;
    }
    let cancelled = false;
    if (detail.market_scan) {
      setMarketScan(detail.market_scan);
      setMarketStatus("ready");
    } else {
      setMarketStatus("loading");
    }
    void ensureCityMarketScan(detailCityName, false, {
      lite: true,
      targetDate: detail.local_date || null,
    })
      .then((payload) => {
        if (cancelled) return;
        setMarketScan(payload || detail.market_scan || null);
        setMarketStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setMarketScan(detail.market_scan || null);
        setMarketStatus(detail.market_scan ? "ready" : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [detail, detailCityName, ensureCityMarketScan]);

  return { marketScan, marketStatus };
}
