"use client";

import { useEffect, useMemo, useState } from "react";
import { Bug, CheckCircle2, Coins, MessageSquare, RefreshCcw } from "lucide-react";
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

const STATUS_UPDATE_OPTIONS = STATUS_OPTIONS.filter((item) => item.key);

const REWARD_POINT_OPTIONS = [
  { value: 100, label: "100 分", title: "轻量提醒" },
  { value: 300, label: "300 分", title: "可复现 Bug" },
  { value: 500, label: "500 分", title: "有效数据问题" },
  { value: 1000, label: "1000 分", title: "高影响问题" },
  { value: 1500, label: "1500 分", title: "重大事故" },
] as const;

const REWARD_GUIDELINES = [
  { points: "0", title: "无效/重复", detail: "重复反馈、无法复现、非问题" },
  { points: "100", title: "轻量提醒", detail: "文案、体验、小范围提示" },
  { points: "300", title: "可复现 Bug", detail: "加载失败、操作异常、局部影响" },
  { points: "500", title: "有效数据问题", detail: "城市数据、图表、关键变量异常" },
  { points: "1000", title: "高影响问题", detail: "支付、账号、订阅、核心终端异常" },
  { points: "1500", title: "重大事故", detail: "大面积不可用或严重业务损失，谨慎使用" },
] as const;

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

export function FeedbackPageClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [payload, setPayload] = useState<UserFeedbackPayload | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [rewardingId, setRewardingId] = useState<number | null>(null);
  const [rewardPointsById, setRewardPointsById] = useState<Record<number, string>>({});

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

  const changeStatus = async (row: UserFeedbackEntry, next: string) => {
    const current = String(row.status || "open").toLowerCase();
    if (!next || next === current) return;
    setUpdatingId(row.id);
    try {
      await opsApi.updateFeedbackStatus(row.id, next);
      await load();
    } finally {
      setUpdatingId(null);
    }
  };

  const updateRewardPoints = (rowId: number, points: string) => {
    setRewardPointsById((prev) => ({
      ...prev,
      [rowId]: points,
    }));
  };

  const handleRewardGrant = async (row: UserFeedbackEntry) => {
    const selectedPoints = rewardPointsById[row.id] || String(REWARD_POINT_OPTIONS[1].value);
    const points = Number.parseInt(selectedPoints, 10);
    if (!row.user_email) {
      setError("这条反馈没有绑定用户邮箱，不能从反馈页直接发放积分。");
      return;
    }
    if (!Number.isFinite(points) || points <= 0) {
      setError("请输入有效的奖励积分。");
      return;
    }
    setRewardingId(row.id);
    setError("");
    try {
      await opsApi.grantFeedbackReward(row.id, points);
      setRewardPointsById((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await load();
    } catch (err) {
      setError(String(err).slice(0, 220));
    } finally {
      setRewardingId(null);
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
        <CardHeader className="pb-2">
          <CardTitle>积分奖励标准</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            {REWARD_GUIDELINES.map((item) => (
              <div
                key={item.points}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div className="font-mono text-sm font-black text-blue-700">
                  {item.points} 分
                </div>
                <div className="mt-1 text-xs font-bold text-slate-900">
                  {item.title}
                </div>
                <div className="mt-1 text-[11px] leading-4 text-slate-500">
                  {item.detail}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            先确认反馈是否有效；未复现的问题可先标为已确认/处理中，奖励发放后会自动记录到用户账户页。
          </p>
        </CardContent>
      </Card>

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
                    <th className="py-2 pr-4 font-bold">奖励</th>
                    <th className="py-2 pr-4 font-bold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const selectedPoints = rewardPointsById[row.id] || String(REWARD_POINT_OPTIONS[1].value);
                    const rewardPoints = Number(row.reward_points || 0);
                    const rewardStatus = String(row.reward_status || "").toLowerCase();
                    const hasReward = rewardStatus === "granted" && rewardPoints > 0;
                    return (
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
                        <td className="min-w-[170px] py-3 pr-4">
                          {hasReward ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                              <div className="font-black text-emerald-700">
                                已发放 +{rewardPoints.toLocaleString()} 分
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <select
                                value={selectedPoints}
                                onChange={(event) => updateRewardPoints(row.id, event.target.value)}
                                disabled={rewardingId === row.id || !row.user_email}
                                className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label="奖励积分"
                              >
                                {REWARD_POINT_OPTIONS.map((item) => (
                                  <option key={item.value} value={item.value}>
                                    {item.label} · {item.title}
                                  </option>
                                ))}
                              </select>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleRewardGrant(row)}
                                disabled={rewardingId === row.id || !row.user_email}
                                className="h-8 gap-1.5"
                              >
                                <Coins className="h-3.5 w-3.5" />
                                发放奖励
                              </Button>
                              {!row.user_email && (
                                <div className="text-[11px] text-amber-700">无用户邮箱，无法直接发放。</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <select
                            value={String(row.status || "open").toLowerCase()}
                            onChange={(event) => changeStatus(row, event.target.value)}
                            disabled={updatingId === row.id}
                            className="h-8 min-w-[108px] rounded border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600 outline-none transition hover:bg-slate-50 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:opacity-60"
                            aria-label="更新反馈状态"
                          >
                            {STATUS_UPDATE_OPTIONS.map((item) => (
                              <option key={item.key} value={item.key}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
