"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Bug, CheckCircle2, Lightbulb, MessageSquare, WalletCards, X } from "lucide-react";
import {
  getAnalyticsClientId,
  getAnalyticsSessionId,
} from "@/lib/app-analytics";
import type { UserFeedbackEntry } from "@/types/ops";

export type FeedbackCategory = "bug" | "data" | "idea" | "payment" | "account" | "other";

export type FeedbackDraft = {
  category?: FeedbackCategory;
  source?: string;
  context?: Record<string, unknown>;
};

const CATEGORY_OPTIONS: Array<{
  key: FeedbackCategory;
  labelZh: string;
  labelEn: string;
  Icon: typeof Bug;
}> = [
  { key: "bug", labelZh: "Bug", labelEn: "Bug", Icon: Bug },
  { key: "data", labelZh: "数据问题", labelEn: "Data issue", Icon: MessageSquare },
  { key: "idea", labelZh: "功能建议", labelEn: "Suggestion", Icon: Lightbulb },
  { key: "payment", labelZh: "支付问题", labelEn: "Payment", Icon: WalletCards },
];

function buildRuntimeContext(extra: Record<string, unknown>) {
  if (typeof window === "undefined") return extra;
  return {
    ...extra,
    client_id: getAnalyticsClientId() || "",
    session_id: getAnalyticsSessionId() || "",
    path: window.location.pathname,
    href: window.location.href,
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    user_agent: navigator.userAgent || "",
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    captured_at: new Date().toISOString(),
  };
}

export function UserFeedbackModal({
  draft,
  isEn,
  onClose,
  onSubmitted,
}: {
  draft: FeedbackDraft | null;
  isEn: boolean;
  onClose: () => void;
  onSubmitted?: (entry?: UserFeedbackEntry) => void;
}) {
  const open = Boolean(draft);
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory(draft?.category || "bug");
    setMessage("");
    setError("");
    setSubmitted(false);
  }, [open, draft?.category]);

  const contextPreview = useMemo(() => {
    const context = draft?.context || {};
    const city = String(context.city || context.display_city || "").trim();
    const source = String(draft?.source || context.source || "terminal").trim();
    if (city) {
      return isEn ? `Context: ${city} · ${source}` : `上下文：${city} · ${source}`;
    }
    return isEn ? `Context: ${source}` : `上下文：${source}`;
  }, [draft, isEn]);

  if (!open) return null;

  const canSubmit = message.trim().length >= 3 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.trim(),
          contact: contact.trim() || undefined,
          source: draft?.source || "terminal",
          context: buildRuntimeContext(draft?.context || {}),
        }),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const payload = (await res.json().catch(() => null)) as {
        feedback?: UserFeedbackEntry;
      } | null;
      setSubmitted(true);
      onSubmitted?.(payload?.feedback);
    } catch (err) {
      setError(String(err).slice(0, 220));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <div className="text-sm font-black text-slate-950">
              {isEn ? "Send feedback" : "提交反馈"}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">{contextPreview}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label={isEn ? "Close feedback" : "关闭反馈"}
          >
            <X size={16} />
          </button>
        </div>

        {submitted ? (
          <div className="px-5 py-8 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
            <div className="mt-3 text-sm font-black text-slate-950">
              {isEn ? "Feedback received" : "反馈已收到"}
            </div>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-slate-500">
              {isEn
                ? "We saved the report with the current terminal context. The bell icon will show handling updates."
                : "已附带当前终端上下文保存。右上角铃铛会显示后续处理进度。"}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded bg-blue-600 px-4 py-2 text-xs font-black text-white transition hover:bg-blue-700"
            >
              {isEn ? "Done" : "完成"}
            </button>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CATEGORY_OPTIONS.map(({ key, labelZh, labelEn, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(key)}
                  className={clsx(
                    "flex h-11 items-center justify-center gap-2 rounded border px-2 text-xs font-bold transition",
                    category === key
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <Icon size={14} />
                  <span>{isEn ? labelEn : labelZh}</span>
                </button>
              ))}
            </div>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">
                {isEn ? "What happened?" : "问题或建议"}
              </span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                className="mt-1 w-full resize-none rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder={
                  isEn
                    ? "Example: This chart keeps loading after I switch to Helsinki."
                    : "例如：切到 Helsinki 后图表一直加载。"
                }
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">
                {isEn ? "Contact, optional" : "联系方式，可选"}
              </span>
              <input
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder={isEn ? "Email or Telegram" : "邮箱或 Telegram"}
              />
            </label>

            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-500">
              {isEn
                ? "Terminal context is attached automatically: city, slot, source state, browser and session diagnostics."
                : "会自动附带终端上下文：城市、槽位、数据源状态、浏览器和会话诊断信息。"}
            </div>

            {error && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {isEn ? "Submit failed: " : "提交失败："}{error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded border border-slate-200 px-4 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
              >
                {isEn ? "Cancel" : "取消"}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="h-9 rounded bg-blue-600 px-4 text-xs font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (isEn ? "Sending..." : "提交中...") : (isEn ? "Send" : "提交")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
