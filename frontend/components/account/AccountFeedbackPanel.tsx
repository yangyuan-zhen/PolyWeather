"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import type { UserFeedbackEntry, UserFeedbackPayload } from "@/types/ops";
import {
  feedbackStatusLabel,
  feedbackStatusTone,
} from "@/components/dashboard/scan-terminal/feedback-status";

function compactDate(value?: string) {
  if (!value) return "--";
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

export function AccountFeedbackPanel({
  isEn,
  title,
  description,
  refreshLabel,
}: {
  isEn: boolean;
  title: string;
  description: string;
  refreshLabel: string;
}) {
  const [entries, setEntries] = useState<UserFeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (typeof fetch !== "function") return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/feedback?limit=10", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      if (res.status === 401 || res.status === 403) {
        setAvailable(false);
        setEntries([]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as UserFeedbackPayload;
      setEntries(Array.isArray(payload.feedback) ? payload.feedback : []);
      setAvailable(true);
    } catch (err) {
      if (signal?.aborted) return;
      setError(String(err).slice(0, 140));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const emptyText = useMemo(() => {
    if (loading) return isEn ? "Loading feedback..." : "正在加载反馈...";
    return isEn ? "No submitted feedback yet." : "暂无已提交反馈。";
  }, [isEn, loading]);

  if (!available) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-12">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-700">
            <MessageSquare size={18} className="text-blue-500" />
            {title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {refreshLabel}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {isEn ? "Failed to load feedback: " : "反馈加载失败："}{error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          {emptyText}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {entries.map((entry) => (
            <div key={entry.id} className="grid gap-3 bg-white px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-black ${feedbackStatusTone(entry.status)}`}>
                    {feedbackStatusLabel(entry.status, isEn)}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500">
                    {categoryLabel(entry.category, isEn)}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {compactDate(entry.created_at)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-slate-900">
                  {entry.message || (isEn ? "Feedback" : "反馈")}
                </p>
              </div>
              <div className="text-xs text-slate-500 md:text-right">
                <div className="font-mono">{compactDate(entry.updated_at)}</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {isEn ? "Updated" : "最近更新"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
