"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TruthHistoryItem = {
  city: string;
  display_name?: string;
  target_date: string;
  actual_high?: number | null;
  settlement_source?: string | null;
  settlement_station_code?: string | null;
  settlement_station_label?: string | null;
  truth_version?: string | null;
  updated_by?: string | null;
  truth_updated_at?: number | null;
  is_final?: boolean | null;
};

type TruthHistoryPayload = {
  items?: TruthHistoryItem[];
  available_cities?: Array<{ city: string; name?: string }>;
  filters?: {
    city?: string | null;
    date_from?: string | null;
    date_to?: string | null;
    limit?: number;
  };
  filtered_count?: number;
};

function formatUnixDateTime(value?: number | null) {
  if (!value) return "-";
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`${url} -> HTTP ${response.status} ${raw.slice(0, 180)}`);
  }
  return response.json() as Promise<T>;
}

export function TruthHistoryDashboard() {
  const [city, setCity] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState("200");
  const [payload, setPayload] = useState<TruthHistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/ops/truth-history", window.location.origin);
      if (city.trim()) url.searchParams.set("city", city.trim());
      if (dateFrom.trim()) url.searchParams.set("date_from", dateFrom.trim());
      if (dateTo.trim()) url.searchParams.set("date_to", dateTo.trim());
      if (limit.trim()) url.searchParams.set("limit", limit.trim());
      const data = await readJson<TruthHistoryPayload>(url.toString());
      setPayload(data);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, [city, dateFrom, dateTo, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = payload?.items || [];
  const availableCities = payload?.available_cities || [];
  const stats = useMemo(() => {
    const uniqueCities = new Set(items.map((item) => item.city)).size;
    const finalCount = items.filter((item) => item.is_final).length;
    return {
      rows: items.length,
      filtered: payload?.filtered_count ?? items.length,
      uniqueCities,
      finalCount,
    };
  }, [items, payload?.filtered_count]);

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-6 text-slate-100 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:gap-6">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-2xl backdrop-blur-xl sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary">Ops</Badge>
                <Badge variant="secondary">Truth History</Badge>
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">真值历史浏览</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-400">
                  面向后台运营/研究的历史真值表格页，支持按城市和日期范围过滤，直接查看最终 `actual_high` 与来源口径。
                </p>
              </div>
            </div>
            <Button onClick={() => void load()} disabled={loading} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              {loading ? "加载中" : "刷新"}
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>当前结果</CardTitle>
              <CardDescription>本次筛选实际返回的记录条数。</CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-slate-100">{stats.rows}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>匹配总数</CardTitle>
              <CardDescription>过滤后总命中条数，返回结果受 limit 限制。</CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-slate-100">{stats.filtered}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>覆盖城市</CardTitle>
              <CardDescription>本次结果涉及的城市数量。</CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-slate-100">{stats.uniqueCities}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Final Rows</CardTitle>
              <CardDescription>当前返回里标记为最终真值的条数。</CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-black text-slate-100">{stats.finalCount}</CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>筛选器</CardTitle>
            <CardDescription>按 city / date range 查历史真值。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_160px_auto]">
            <select
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">全部城市</option>
              {availableCities.map((item) => (
                <option key={item.city} value={item.city}>
                  {item.name || item.city}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
            <input
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
            <Button onClick={() => void load()} disabled={loading}>
              应用筛选
            </Button>
          </CardContent>
        </Card>

        {error ? (
          <Card className="border-rose-500/30 bg-rose-500/10">
            <CardHeader>
              <CardTitle className="text-rose-300">加载失败</CardTitle>
              <CardDescription className="text-rose-200/80">{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>历史真值表</CardTitle>
            <CardDescription>
              字段包括 `actual_high`、`settlement_source`、`station_code`、`truth_version`、`updated_by`、`updated_at`。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/70">
              <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">City</th>
                    <th className="px-4 py-3">Actual</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Station</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Updated By</th>
                    <th className="px-4 py-3">Updated At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {items.map((item) => (
                    <tr key={`${item.city}-${item.target_date}`}>
                      <td className="px-4 py-3">{item.target_date}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-100">{item.display_name || item.city}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.city}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-100">{item.actual_high ?? "-"}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.is_final ? "final" : "non-final"}</div>
                      </td>
                      <td className="px-4 py-3">{item.settlement_source || "-"}</td>
                      <td className="px-4 py-3">
                        <div>{item.settlement_station_code || "-"}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.settlement_station_label || "-"}</div>
                      </td>
                      <td className="px-4 py-3">{item.truth_version || "-"}</td>
                      <td className="px-4 py-3">{item.updated_by || "-"}</td>
                      <td className="px-4 py-3">{formatUnixDateTime(item.truth_updated_at)}</td>
                    </tr>
                  ))}
                  {!items.length ? (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={8}>
                        当前筛选条件下没有历史真值记录
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
