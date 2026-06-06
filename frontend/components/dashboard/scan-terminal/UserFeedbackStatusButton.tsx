"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, RefreshCcw } from "lucide-react";
import type { UserFeedbackEntry, UserFeedbackPayload } from "@/types/ops";
import {
  buildFeedbackNotificationKey,
  countUnseenFeedbackUpdates,
  feedbackStatusLabel,
  feedbackStatusTone,
} from "./feedback-status";

const FEEDBACK_STATUS_SEEN_KEY = "polyweather_feedback_status_seen_v1";
const FEEDBACK_STATUS_POLL_MS = 60_000;

function loadSeenKeys() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(FEEDBACK_STATUS_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function saveSeenKeys(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = Array.from(keys).slice(-200);
    window.localStorage.setItem(FEEDBACK_STATUS_SEEN_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage failures; the badge can reappear without breaking feedback status.
  }
}

function compactDate(value?: string) {
  if (!value) return "";
  return value.slice(0, 16).replace("T", " ");
}

function categoryLabel(value?: string, isEn = false) {
  const key = String(value || "").toLowerCase();
  if (key === "bug") return "Bug";
  if (key === "data") return isEn ? "Data" : "数据";
  if (key === "idea") return isEn ? "Suggestion" : "建议";
  if (key === "payment") return isEn ? "Payment" : "支付";
  if (key === "account") return isEn ? "Account" : "账号";
  return isEn ? "Other" : "其他";
}

export function UserFeedbackStatusButton({
  isEn,
  refreshKey = 0,
}: {
  isEn: boolean;
  refreshKey?: number;
}) {
  const [available, setAvailable] = useState(true);
  const [entries, setEntries] = useState<UserFeedbackEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => loadSeenKeys());

  const unseenCount = useMemo(
    () => countUnseenFeedbackUpdates(entries, seenKeys),
    [entries, seenKeys],
  );
  const emptyStateText = loading
    ? isEn
      ? "Loading..."
      : "加载中..."
    : isEn
      ? "No submitted feedback yet."
      : "暂无已提交反馈。";

  const load = useCallback(async (signal?: AbortSignal) => {
    if (typeof fetch !== "function") return;
    setLoading(true);
    try {
      const res = await fetch("/api/feedback?limit=12", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      if (res.status === 401 || res.status === 403) {
        setAvailable(false);
        setEntries([]);
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = (await res.json()) as UserFeedbackPayload;
      setEntries(Array.isArray(payload.feedback) ? payload.feedback : []);
      setAvailable(true);
      setError("");
    } catch (err) {
      if (signal?.aborted) return;
      setError(String(err).slice(0, 120));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const markVisibleAsSeen = useCallback((visibleEntries: UserFeedbackEntry[]) => {
    setSeenKeys((current) => {
      const next = new Set(current);
      visibleEntries.forEach((entry) => next.add(buildFeedbackNotificationKey(entry)));
      saveSeenKeys(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, FEEDBACK_STATUS_POLL_MS);

    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(id);
    };
  }, [load, refreshKey]);

  useEffect(() => {
    if (open) markVisibleAsSeen(entries);
  }, [entries, markVisibleAsSeen, open]);

  if (!available) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => {
            const next = !value;
            if (next) markVisibleAsSeen(entries);
            return next;
          });
        }}
        className="relative grid h-7 w-7 place-items-center rounded-full border border-slate-300 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
        title={isEn ? "Feedback status" : "反馈处理状态"}
        aria-label={isEn ? "Feedback status" : "反馈处理状态"}
      >
        <Bell size={13} />
        {unseenCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-blue-600 px-1 text-[9px] font-black leading-none text-white ring-2 ring-white">
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-[70] w-[340px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-slate-200 bg-white text-slate-800 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <div>
              <div className="text-xs font-black text-slate-950">
                {isEn ? "Feedback updates" : "反馈处理动态"}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {isEn ? "Your submitted reports only" : "仅显示你提交过的反馈"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="grid h-7 w-7 place-items-center rounded border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
              title={isEn ? "Refresh" : "刷新"}
              aria-label={isEn ? "Refresh feedback status" : "刷新反馈状态"}
            >
              <RefreshCcw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {error && (
            <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              {isEn ? "Status refresh failed: " : "状态刷新失败："}{error}
            </div>
          )}

          {entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">
              {emptyStateText}
            </div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              {entries.map((entry) => (
                <div key={entry.id} className="border-b border-slate-100 px-3 py-2 last:border-b-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-slate-900">
                        {entry.message || (isEn ? "Feedback" : "反馈")}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span>{categoryLabel(entry.category, isEn)}</span>
                        {entry.created_at && <span>{compactDate(entry.created_at)}</span>}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-black ${feedbackStatusTone(entry.status)}`}>
                      {feedbackStatusLabel(entry.status, isEn)}
                    </span>
                  </div>
                  {entry.updated_at && entry.updated_at !== entry.created_at && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {isEn ? "Updated " : "更新于 "}{compactDate(entry.updated_at)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
