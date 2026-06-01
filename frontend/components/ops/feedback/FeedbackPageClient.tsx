"use client";

import { useEffect, useMemo, useState } from "react";
import { Bug, CheckCircle2, MessageSquare, RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { UserFeedbackEntry, UserFeedbackPayload } from "@/types/ops";

const STATUS_OPTIONS = [
  { key: "", label: "全部" },
  { key: "open", label: "新建" },
  { key: "triaged", label: "已确认" },
  { key: "investigating", label: "处理中" },
  { key: "resolved", label: "已解决" },
  { key: "closed", label: "关闭" },
] as const;

const NEXT_STATUS: Record<string, string> = {
  open: "triaged",
  triaged: "investigating",
  investigating: "resolved",
  resolved: "closed",
  closed: "open",
};

function compactDate(value?: string) {
  if (!value) return "—";
  return value.slice(0, 19).replace("T", " ");
}

function categoryLabel(value?: string) {
  const key = String(value || "").toLowerCase();
  if (key === "bug") return "Bug";
  if (key === "data") return "数据";
  if (key === "idea") return "建议";
  if (key === "payment") return "支付";
  if (key === "account") return "账号";
  return "其他";
}

function statusLabel(value?: string) {
  const key = String(value || "open").toLowerCase();
  if (key === "open") return "新建";
  if (key === "triaged") return "已确认";
  if (key === "investigating") return "处理中";
  if (key === "resolved") return "已解决";
  if (key === "closed") return "关闭";
  return key;
}

function statusTone(value?: string) {
  const key = String(value || "open").toLowerCase();
  if (key === "open") return "border-red-200 bg-red-50 text-red-700";
  if (key === "triaged") return "border-amber-200 bg-amber-50 text-amber-700";
  if (key === "investigating") return "border-blue-200 bg-blue-50 text-blue-700";
  if (key === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function contextSummary(context?: Record<string, unknown>) {
  if (!context) return "—";
  const city = String(context.city || context.display_city || "").trim();
  const slot = context.slot_index != null ? `slot ${context.slot_index}` : "";
  const source = String(context.source || "").trim();
  const pieces = [city, slot, source].filter(Boolean);
  return pieces.length ? pieces.join(" · ") : "terminal";
}

function feedbackActionLabel(status?: string) {
  const next = NEXT_STATUS[String(status || "open").toLowerCase()] || "triaged";
  return statusLabel(next);
}

export function FeedbackPageClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [payload, setPayload] = useState<UserFeedbackPayload | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = (await opsApi.feedback(120, filter)) as UserFeedbackPayload;
      setPayload(data);
    } catch (err) {
      setError(String(err).slice(0, 220));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filter]);

  const rows = payload?.feedback || [];
  const counts = payload?.status_counts || {};
  const openCount = Number(counts.open || 0);
  const activeCount = Number(counts.open || 0) + Number(counts.triaged || 0) + Number(counts.investigating || 0);

  const categoryCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    rows.forEach((row) => {
      const key = String(row.category || "other");
      acc[key] = (acc[key] || 0) + 1;
    });
    return acc;
  }, [rows]);

  const advanceStatus = async (row: UserFeedbackEntry) => {
    const next = NEXT_STATUS[String(row.status || "open").toLowerCase()] || "triaged";
    setUpdatingId(row.id);
    try {
      await opsApi.updateFeedbackStatus(row.id, next);
      await load();
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading && !payload) {
    return <div className="text-slate-400 animate-pulse">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">用户反馈</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          加载失败：{error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Bug className="h-5 w-5 text-red-500" />
            <div>
              <div className="text-xs text-slate-500">新反馈</div>
              <div className="text-2xl font-black text-slate-950">{openCount}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <MessageSquare className="h-5 w-5 text-blue-500" />
            <div>
              <div className="text-xs text-slate-500">处理中</div>
              <div className="text-2xl font-black text-slate-950">{activeCount}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <div>
              <div className="text-xs text-slate-500">已解决</div>
              <div className="text-2xl font-black text-slate-950">{Number(counts.resolved || 0)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">当前列表</div>
            <div className="mt-1 text-2xl font-black text-slate-950">{rows.length}</div>
            <div className="mt-1 text-xs text-slate-500">
              Bug {categoryCounts.bug || 0} · 数据 {categoryCounts.data || 0} · 建议 {categoryCounts.idea || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>反馈收件箱</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((item) => (
              <button
                key={item.key || "all"}
                type="button"
                onClick={() => setFilter(item.key)}
                className={
                  "rounded border px-2.5 py-1 text-xs font-bold transition " +
                  (filter === item.key
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              暂无反馈。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-bold">状态</th>
                    <th className="py-2 pr-4 font-bold">类型</th>
                    <th className="py-2 pr-4 font-bold">内容</th>
                    <th className="py-2 pr-4 font-bold">上下文</th>
                    <th className="py-2 pr-4 font-bold">用户</th>
                    <th className="py-2 pr-4 font-bold">时间</th>
                    <th className="py-2 pr-4 font-bold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="py-3 pr-4">
                        <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-slate-500">{categoryLabel(row.category)}</td>
                      <td className="max-w-xl py-3 pr-4">
                        <div className="font-semibold leading-5 text-slate-900">{row.message || "—"}</div>
                        {row.contact && <div className="mt-1 text-xs text-slate-500">联系：{row.contact}</div>}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-mono text-xs text-blue-700">{contextSummary(row.context)}</div>
                        {Boolean(row.context?.detail_error) && (
                          <div className="mt-1 max-w-xs text-xs text-amber-700">
                            {String(row.context?.detail_error || "").slice(0, 120)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                        {row.user_email || row.user_id || "—"}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-xs text-slate-500">{compactDate(row.created_at)}</td>
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          onClick={() => advanceStatus(row)}
                          disabled={updatingId === row.id}
                          className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                        >
                          标为{feedbackActionLabel(row.status)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
