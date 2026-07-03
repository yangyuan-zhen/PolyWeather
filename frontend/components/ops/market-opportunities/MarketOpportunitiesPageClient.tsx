"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCcw, Search, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { opsApi } from "@/lib/ops-api";

type MarketOpportunityRow = {
  id?: string;
  city?: string;
  display_name?: string;
  target_date?: string;
  bucket_label?: string;
  side?: string;
  ask_price?: number;
  model_probability?: number;
  edge?: number;
  liquidity?: number | null;
  volume?: number | null;
  market_url?: string;
  current_max_so_far?: number | null;
  deb_prediction?: number | null;
  model_median?: number | null;
  model_spread?: number | null;
  local_time?: string;
  region?: string;
};

type MarketOpportunitiesPayload = {
  generated_at?: string;
  summary?: {
    opportunity_count?: number;
    positive_edge_count?: number;
    min_price?: number | null;
    max_edge?: number | null;
    quote_status?: string;
    scanned_city_count?: number;
    matched_event_count?: number;
    error?: string | null;
  };
  rows?: MarketOpportunityRow[];
};

function percent(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function cents(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(value * 100 < 1 ? 1 : 0)}¢`;
}

function numberLabel(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value.toFixed(1);
}

function tempLabel(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function generatedLabel(value?: string) {
  if (!value) return "—";
  return value.slice(0, 19).replace("T", " ");
}

function sideTone(side?: string) {
  return String(side).toLowerCase() === "no"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

export function MarketOpportunitiesPageClient() {
  const [payload, setPayload] = useState<MarketOpportunitiesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [side, setSide] = useState("both");
  const [maxPrice, setMaxPrice] = useState("0.20");
  const [minEdge, setMinEdge] = useState("0");
  const [showAllLowPrice, setShowAllLowPrice] = useState(false);

  const positive_edge_only = !showAllLowPrice;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await opsApi.marketOpportunities({
        q: query.trim(),
        side,
        max_price: maxPrice,
        min_edge: showAllLowPrice ? "-1" : minEdge,
        positive_edge_only,
        limit: 200,
      });
      setPayload(data as MarketOpportunitiesPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载市场机会失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, showAllLowPrice]);

  const rows = useMemo(() => payload?.rows ?? [], [payload]);
  const summary = payload?.summary ?? {};
  const quoteStatus = summary.quote_status || "unknown";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <TrendingUp className="h-5 w-5 text-blue-300" />
            市场机会
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            仅 Ops 内部使用，按价格上限扫描 Yes/No 选项，并按模型概率与市场价格差排序。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="机会数" value={summary.opportunity_count ?? rows.length} sub="当前筛选结果" />
        <Stat label="正边际" value={summary.positive_edge_count ?? 0} sub="模型概率高于买入价" />
        <Stat label="最低价格" value={cents(summary.min_price)} sub="低价合约下限" />
        <Stat label="最大 Edge" value={percent(summary.max_edge)} sub="模型概率 - 市场价" />
        <Stat label="报价状态" value={quoteStatus} sub={`${summary.matched_event_count ?? 0}/${summary.scanned_city_count ?? 0} 城市匹配`} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle>低价选项扫描</CardTitle>
          <div className="grid items-end gap-2 md:grid-cols-[minmax(180px,1fr)_120px_132px_132px_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void load();
                }}
                className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder="搜索城市或选项"
              />
            </label>
            <label className="block">
              <span className="sr-only">方向</span>
              <select
                value={side}
                onChange={(event) => setSide(event.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700"
              >
                <option value="both">Yes / No</option>
                <option value="yes">仅 Yes</option>
                <option value="no">仅 No</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                最高买入价
              </span>
              <input
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700"
                inputMode="decimal"
                aria-label="最高买入价"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-500">
                最小 Edge
              </span>
              <input
                value={minEdge}
                onChange={(event) => setMinEdge(event.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700"
                inputMode="decimal"
                aria-label="最小 Edge"
              />
            </label>
            <Button variant="outline" size="sm" onClick={load}>
              应用筛选
            </Button>
          </div>
          <label className="flex w-fit items-center gap-2 text-sm font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={showAllLowPrice}
              onChange={(event) => setShowAllLowPrice(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            显示全部低价
          </label>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}
          {summary.error ? (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
              报价不可用：{summary.error}
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-[1320px] w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">城市</th>
                  <th className="px-3 py-2">选项</th>
                  <th className="px-3 py-2">方向</th>
                  <th className="px-3 py-2 text-right">买入价</th>
                  <th className="px-3 py-2 text-right">模型概率</th>
                  <th className="px-3 py-2 text-right">Edge</th>
                  <th className="px-3 py-2 text-right">当前最高</th>
                  <th className="px-3 py-2 text-right">DEB</th>
                  <th className="px-3 py-2 text-right">模型中位数</th>
                  <th className="px-3 py-2 text-right">分歧</th>
                  <th className="px-3 py-2 text-right">流动性</th>
                  <th className="px-3 py-2 text-right">成交量</th>
                  <th className="px-3 py-2">市场链接</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={13} className="px-3 py-10 text-center text-sm font-semibold text-slate-400">
                      加载中...
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((row) => (
                    <tr key={row.id || `${row.city}-${row.bucket_label}-${row.side}`} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 font-black text-slate-900">
                        <div>{row.display_name || row.city || "—"}</div>
                        <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
                          {row.local_time || "—"} · {row.target_date || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-800">{row.bucket_label || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex min-w-10 justify-center rounded-md border px-2 py-1 text-xs font-black uppercase ${sideTone(row.side)}`}>
                          {row.side || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-black text-slate-950">{cents(row.ask_price)}</td>
                      <td className="px-3 py-2 text-right font-bold text-blue-700">{percent(row.model_probability)}</td>
                      <td className="px-3 py-2 text-right font-black text-emerald-700">{percent(row.edge)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{tempLabel(row.current_max_so_far)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-orange-700">{tempLabel(row.deb_prediction)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{tempLabel(row.model_median)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{tempLabel(row.model_spread)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{numberLabel(row.liquidity)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{numberLabel(row.volume)}</td>
                      <td className="px-3 py-2">
                        {row.market_url ? (
                          <a
                            href={row.market_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-black text-blue-700 hover:text-blue-900"
                          >
                            打开 <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={13} className="px-3 py-10 text-center text-sm font-semibold text-slate-400">
                      当前筛选下没有低价市场机会。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs font-semibold text-slate-400">
            生成时间：{generatedLabel(payload?.generated_at)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
