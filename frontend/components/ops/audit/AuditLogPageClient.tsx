"use client";

import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { opsApi } from "@/lib/ops-api";
import type { OpsAuditEvent } from "@/types/ops";

function compactDate(value?: string) {
  if (!value) return "--";
  return value.slice(0, 19).replace("T", " ");
}

function actionLabel(action?: string) {
  const key = String(action || "").trim().toLowerCase();
  if (key === "manual_points_grant") return "手动补分";
  if (key === "feedback_reward_grant") return "反馈奖励";
  if (key === "subscription_manual_grant") return "手动开通";
  if (key === "subscription_manual_extend") return "会员延期";
  if (key === "refund_case_create") return "创建退款工单";
  if (key === "refund_case_update") return "更新退款工单";
  return key || "未知操作";
}

export function AuditLogPageClient() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<OpsAuditEvent[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const payload = (await opsApi.auditLog(150)) as { events?: OpsAuditEvent[] };
      setEvents(payload.events ?? []);
    } catch {
      setEvents([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">审计日志</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>管理员操作 ({events.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-slate-500">加载中...</div>
          ) : events.length === 0 ? (
            <div className="text-sm text-slate-500">暂无审计事件</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-bold">时间</th>
                    <th className="py-2 pr-4 font-bold">操作</th>
                    <th className="py-2 pr-4 font-bold">管理员</th>
                    <th className="py-2 pr-4 font-bold">对象</th>
                    <th className="py-2 pr-4 font-bold">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-slate-100">
                      <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-slate-500">
                        {compactDate(event.created_at)}
                      </td>
                      <td className="py-2 pr-4 font-bold text-slate-900">
                        {actionLabel(event.action)}
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-600">
                        {event.actor_email || "--"}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="font-mono text-xs text-blue-700">
                          {event.target_email || event.target_user_id || event.target_id || "--"}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {event.target_type || "--"}
                        </div>
                      </td>
                      <td className="max-w-md py-2 pr-4">
                        <code className="block truncate rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                          {JSON.stringify(event.payload ?? {})}
                        </code>
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
