"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCcw, CheckCircle2, ExternalLink, AlertTriangle, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type {
  BillingRiskIssue,
  BillingRiskPayload,
  PaymentRuntimePayload,
  PaymentIncident,
  PaymentRecord,
} from "@/types/ops";

const PaymentIncidentPieChart = dynamic(
  () => import("./PaymentIncidentPieChart").then((mod) => mod.PaymentIncidentPieChart),
  {
    ssr: false,
    loading: () => <span className="text-sm text-slate-500">加载图表...</span>,
  },
);

function paymentExplorerUrl(payment: PaymentRecord): string {
  const txHash = String(payment.tx_hash || "").trim();
  if (!txHash) return "";
  const chain = String(payment.chain || "").trim().toLowerCase();
  const base = chain.includes("eth")
    ? "https://etherscan.io"
    : "https://polygonscan.com";
  return `${base}/tx/${txHash}`;
}

function severityTone(severity?: string) {
  if (severity === "high") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function severityLabel(severity?: string) {
  if (severity === "high") return "高";
  if (severity === "medium") return "中";
  if (severity === "low") return "低";
  return severity || "未知";
}

function compactDate(value?: string) {
  if (!value) return "—";
  return value.slice(0, 19).replace("T", " ");
}

function paymentReasonLabel(reason?: string) {
  const key = String(reason || "").trim().toLowerCase();
  if (key === "receiver_mismatch") return "收款地址不匹配";
  if (key === "amount_mismatch") return "金额不匹配";
  if (key === "chain_mismatch") return "支付网络不匹配";
  if (key === "tx_not_found") return "链上交易未找到";
  if (key === "tx_reverted") return "链上交易失败";
  if (key === "expired") return "订单已过期";
  if (key === "event_mismatch") return "支付事件不匹配";
  if (key === "direct_transfer_mismatch") return "直接转账不匹配";
  if (key === "unknown") return "未知原因";
  return key || "未知原因";
}

function compactMono(value?: string, head = 10, tail = 6) {
  const text = String(value || "").trim();
  if (!text) return "—";
  if (text.length <= head + tail + 3) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function RiskStat({
  label,
  value,
  sub,
  tone = "text-slate-950",
}: {
  label: string;
  value: number;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-black ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

export function PaymentsPageClient() {
  const [loading, setLoading] = useState(true);
  const [runtime, setRuntime] = useState<PaymentRuntimePayload | null>(null);
  const [incidents, setIncidents] = useState<PaymentIncident[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [risk, setRisk] = useState<BillingRiskPayload | null>(null);
  const [resolving, setResolving] = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const [rt, inc, pay, riskPayload] = await Promise.all([
        opsApi.paymentRuntime() as Promise<PaymentRuntimePayload>,
        opsApi.incidents(50),
        opsApi.listPayments(50),
        opsApi.billingRisk(30, 80) as Promise<BillingRiskPayload>,
      ]);
      setRuntime(rt);
      setIncidents((inc as unknown as { incidents?: PaymentIncident[] }).incidents ?? []);
      setPayments((pay as unknown as { payments?: PaymentRecord[] }).payments ?? []);
      setRisk(riskPayload);
    } catch { /* */ }
    setLoading(false);
  };

  const handleResolve = async (id: number) => {
    setResolving((prev) => new Set(prev).add(id));
    try {
      await opsApi.resolveIncident(id);
      setIncidents((prev) => prev.filter((i) => i.id !== id));
    } catch { /* */ }
    setResolving((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  useEffect(() => { void load(); }, []);

  if (loading) return <div className="text-slate-400 animate-pulse">加载中...</div>;

  const reasonCounts: Record<string, number> = {};
  incidents.forEach((inc) => {
    const r = inc.reason || "unknown";
    reasonCounts[r] = (reasonCounts[r] || 0) + Math.max(1, Number(inc.occurrence_count ?? 1));
  });

  const incidentPieData = Object.entries(reasonCounts).map(([name, value]) => ({
    name,
    value,
  }));
  const riskSummary = risk?.summary ?? {};
  const riskIssues = risk?.issues ?? [];
  const referralRewards = risk?.recent_referral_rewards ?? [];
  const hasRisk = Number(riskSummary.issues ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">支付管理</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {hasRisk ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <ShieldCheck className="h-4 w-4 text-emerald-500" />}
            支付与邀请风控流水
          </CardTitle>
          <span className="text-xs text-slate-500">最近 {risk?.window_days ?? 30} 天 · {compactDate(risk?.checked_at)}</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <RiskStat label="总异常" value={Number(riskSummary.issues ?? 0)} sub="需要人工关注" tone={hasRisk ? "text-red-600" : "text-emerald-600"} />
            <RiskStat label="Intent 卡住" value={Number(riskSummary.stuck_intents ?? 0)} sub="submitted/过期 created" />
            <RiskStat label="试用漏开" value={Number(riskSummary.trial_gaps ?? 0)} sub="后端试用/订阅证据缺失" />
            <RiskStat label="支付异常" value={Number(riskSummary.payment_incidents ?? incidents.length)} sub="未标记处理" />
            <RiskStat label="积分异常" value={Number(riskSummary.points_discount_issues ?? 0)} sub="确认后未扣/少扣" />
            <RiskStat label="推荐异常" value={Number(riskSummary.referral_settlement_issues ?? 0)} sub="转化无奖励记录" />
            <RiskStat label="上限命中" value={Number(riskSummary.monthly_cap_hits ?? 0)} sub="月度邀请封顶" />
          </div>

          {risk?.query_errors?.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              部分 Supabase 表查询失败：{risk.query_errors.map((item) => item.table).filter(Boolean).join(", ")}
            </div>
          ) : null}

          {riskIssues.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
              暂无试用、支付、推荐奖励或积分抵扣风险信号。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-bold">级别</th>
                    <th className="py-2 pr-4 font-bold">类型</th>
                    <th className="py-2 pr-4 font-bold">问题</th>
                    <th className="py-2 pr-4 font-bold">用户</th>
                    <th className="py-2 pr-4 font-bold">时间</th>
                    <th className="py-2 pr-4 font-bold">引用</th>
                  </tr>
                </thead>
                <tbody>
                  {riskIssues.slice(0, 30).map((issue: BillingRiskIssue, index) => (
                    <tr key={`${issue.category}-${issue.reference}-${index}`} className="border-b border-slate-100">
                      <td className="py-2 pr-4">
                        <span className={`inline-flex min-w-8 items-center justify-center rounded-md border px-2 py-1 text-xs font-bold ${severityTone(issue.severity)}`}>
                          {severityLabel(issue.severity)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-slate-500">{issue.category ?? "—"}</td>
                      <td className="py-2 pr-4">
                        <div className="font-bold text-slate-900">{issue.title ?? "—"}</div>
                        <div className="mt-0.5 max-w-xl text-xs text-slate-500">{issue.detail ?? "—"}</div>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-500">{issue.user_id ? `${issue.user_id.slice(0, 10)}...` : "—"}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-xs text-slate-500">{compactDate(issue.created_at)}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-blue-700">{issue.reference ? String(issue.reference).slice(0, 14) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>支付运行时</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {runtime ? Object.entries({
                chain_id: runtime.chain_id,
                last_scanned_block: runtime.last_scanned_block,
                audit_events_count: runtime.audit_events_count,
              }).map(([k, v]) => (
                <div key={k}>
                  <div className="text-slate-500 text-xs">{k}</div>
                  <div className="text-white font-mono">{String(v ?? "—")}</div>
                </div>
              )) : <span className="text-slate-500">无数据</span>}
            </dl>
            {runtime?.receiver_contract ? (
              <div className="mt-3">
                <div className="text-slate-500 text-xs">receiver_contract</div>
                <code className="text-xs text-blue-300 bg-black/40 rounded-lg px-2 py-1.5 block mt-1 truncate">{runtime.receiver_contract}</code>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>异常原因分布</CardTitle></CardHeader>
          <CardContent className="h-[125px] flex items-center justify-center p-3">
            {incidentPieData.length === 0 ? (
              <span className="text-sm text-slate-500">暂无异常数据</span>
            ) : (
              <PaymentIncidentPieChart data={incidentPieData} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>推荐奖励结算 ({referralRewards.length})</CardTitle></CardHeader>
        <CardContent>
          {referralRewards.length === 0 ? (
            <span className="text-sm text-slate-500">最近没有推荐奖励记录</span>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-bold">ID</th>
                    <th className="py-2 pr-4 font-bold">邀请人</th>
                    <th className="py-2 pr-4 font-bold">被邀请人</th>
                    <th className="py-2 pr-4 font-bold">奖励</th>
                    <th className="py-2 pr-4 font-bold">Intent</th>
                    <th className="py-2 pr-4 font-bold">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {referralRewards.slice(0, 20).map((row, index) => (
                    <tr key={`${row.id}-${index}`} className="border-b border-slate-100">
                      <td className="py-2 pr-4 font-mono text-xs text-slate-500">{String(row.id ?? "—")}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-500">{String(row.referrer_user_id ?? "—").slice(0, 10)}...</td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-500">{String(row.referred_user_id ?? "—").slice(0, 10)}...</td>
                      <td className="py-2 pr-4 text-emerald-700 font-bold">+{Number(row.reward_points ?? 0).toLocaleString()} 分</td>
                      <td className="py-2 pr-4 font-mono text-xs text-blue-700">{String(row.payment_intent_id ?? "—").slice(0, 14)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-xs text-slate-500">{compactDate(String(row.created_at ?? ""))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>支付异常 ({incidents.length})</CardTitle></CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <span className="text-sm text-slate-500">暂无异常</span>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-slate-400">
                    <th className="py-2 pr-4 font-medium">ID</th>
                    <th className="py-2 pr-4 font-medium">原因 / 详情</th>
                    <th className="py-2 pr-4 font-medium">用户 / Intent</th>
                    <th className="py-2 pr-4 font-medium">时间</th>
                    <th className="py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr key={inc.id} className="border-b border-white/5">
                      <td className="py-2 pr-4 text-slate-500 font-mono">{inc.id}</td>
                      <td className="py-2 pr-4">
                        <div className="font-bold text-amber-600">{paymentReasonLabel(inc.reason)}</div>
                        {Number(inc.occurrence_count ?? 1) > 1 ? (
                          <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
                            同类重复 {Number(inc.occurrence_count).toLocaleString()} 次 · 最早 {compactDate(inc.first_seen_at)}
                          </div>
                        ) : null}
                        <div className="mt-0.5 max-w-xl truncate text-xs text-slate-500" title={inc.detail || inc.reason || ""}>
                          {inc.detail || inc.reason || "—"}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-500">
                        <div className="font-mono" title={inc.user_id || ""}>{compactMono(inc.user_id)}</div>
                        <div className="mt-0.5 font-mono text-blue-700" title={inc.intent_id || ""}>{compactMono(inc.intent_id, 12, 6)}</div>
                      </td>
                      <td className="py-2 pr-4 text-slate-400 text-xs">{inc.created_at?.slice(0, 19) ?? "—"}</td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolving.has(inc.id)}
                          onClick={() => handleResolve(inc.id)}
                          className="gap-1 h-7 text-xs"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {resolving.has(inc.id) ? "处理中" : "标记处理"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>成功支付记录 ({payments.length})</CardTitle></CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <span className="text-sm text-slate-500">暂无记录</span>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-slate-400">
                    <th className="py-2 pr-4 font-medium">ID</th>
                    <th className="py-2 pr-4 font-medium">用户</th>
                    <th className="py-2 pr-4 font-medium">金额</th>
                    <th className="py-2 pr-4 font-medium">链</th>
                    <th className="py-2 pr-4 font-medium">Tx Hash</th>
                    <th className="py-2 pr-4 font-medium">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-white/5">
                      <td className="py-2 pr-4 text-slate-500 font-mono text-xs">{p.id}</td>
                      <td className="py-2 pr-4 text-slate-400 font-mono text-xs" title={p.user_id}>{p.user_id?.slice(0, 10) ?? "—"}...</td>
                      <td className="py-2 pr-4 text-emerald-300 font-mono">{p.amount} {p.currency}</td>
                      <td className="py-2 pr-4 text-slate-400 text-xs">{p.chain ?? "—"}</td>
                      <td className="py-2 pr-4 text-xs">
                        {p.tx_hash ? (
                          <a
                            href={paymentExplorerUrl(p)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-mono inline-flex items-center gap-1"
                          >
                            {p.tx_hash.slice(0, 8)}...{p.tx_hash.slice(-6)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-slate-400 text-xs whitespace-nowrap">{p.created_at?.slice(0, 19) ?? "—"}</td>
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
