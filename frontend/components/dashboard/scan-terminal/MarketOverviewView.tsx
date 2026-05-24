"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { ScanOpportunityRow, ScanTerminalResponse } from "@/lib/dashboard-types";
import {
  resolveTradingRegionKey,
  TRADING_REGIONS,
} from "@/components/dashboard/scan-terminal/continent-grouping";
import { Panel } from "@/components/dashboard/scan-terminal/Panel";
import { edgeClass, money, pct, rowName } from "@/components/dashboard/scan-terminal/utils";

type Holder = {
  amount?: number;
  name?: string;
  outcomeIndex?: number;
  proxyWallet?: string;
  pseudonym?: string;
};

type HolderInfo = {
  holders: Holder[] | null;
  loading: boolean;
};

const MARKET_OVERVIEW_REFRESH_MS = 10 * 60_000;

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rowLiquidity(row: ScanOpportunityRow) {
  return numeric(row.book_liquidity || row.market_liquidity || row.volume);
}

function rowOpportunityScore(row: ScanOpportunityRow) {
  return (
    numeric(row.final_score) * 0.5 +
    numeric(row.edge_percent ?? row.signed_gap ?? row.gap) * 2 +
    Math.log10(rowLiquidity(row) + 1)
  );
}

function rowSpread(row: ScanOpportunityRow) {
  return numeric(row.spread);
}

function isStale(row: ScanOpportunityRow) {
  return Boolean(row.metar_context?.stale_for_today || row.metar_status?.stale_for_today);
}

function isWatch(row: ScanOpportunityRow) {
  const value = String(row.ai_decision || row.v4_metar_decision || row.signal_status || row.action || "").toLowerCase();
  return value.includes("watch") || !row.tradable;
}

function holderLabel(holder: Holder) {
  return (
    holder.name ||
    holder.pseudonym ||
    (holder.proxyWallet ? `${String(holder.proxyWallet).slice(0, 6)}...${String(holder.proxyWallet).slice(-4)}` : "--")
  );
}

function CompactRowsTable({
  empty,
  isEn,
  onSelectRow,
  rows,
  showSpread = false,
}: {
  empty: string;
  isEn: boolean;
  onSelectRow: (row: ScanOpportunityRow) => void;
  rows: ScanOpportunityRow[];
  showSpread?: boolean;
}) {
  if (!rows.length) {
    return <div className="px-3 py-8 text-center text-[11px] text-slate-400">{empty}</div>;
  }
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
          <th className="px-3 py-1.5 text-left font-black">{isEn ? "City / Contract" : "城市 / 合约"}</th>
          <th className="px-2 py-1.5 text-right font-black">{isEn ? "Model" : "模型"}</th>
          <th className="px-2 py-1.5 text-right font-black">{isEn ? "Market" : "市场"}</th>
          <th className="px-2 py-1.5 text-right font-black">{showSpread ? (isEn ? "Spread" : "价差") : "Edge"}</th>
          <th className="px-3 py-1.5 text-right font-black">{isEn ? "Liq" : "流动性"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const edge = numeric(row.edge_percent ?? row.signed_gap ?? row.gap);
          return (
            <tr
              key={row.id}
              onClick={() => onSelectRow(row)}
              className="cursor-pointer border-b border-slate-100 hover:bg-blue-50"
            >
              <td className="px-3 py-1.5">
                <div className="truncate font-bold text-slate-800">{rowName(row)}</div>
                <div className="truncate text-[10px] font-medium text-slate-400">{row.target_label || row.market_question || "--"}</div>
              </td>
              <td className="px-2 py-1.5 text-right font-mono">{pct(row.model_probability ?? row.model_event_probability)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{pct(row.market_probability ?? row.market_event_probability)}</td>
              <td className={clsx("px-2 py-1.5 text-right font-mono font-bold", showSpread ? "text-slate-700" : edgeClass(edge))}>
                {showSpread ? pct(row.spread) : pct(edge)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{money(rowLiquidity(row))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MarketOverviewView({
  isEn,
  onSelectRow,
  rows,
}: {
  isEn: boolean;
  onSelectRow: (row: ScanOpportunityRow) => void;
  rows: ScanOpportunityRow[];
}) {
  const [overviewRows, setOverviewRows] = useState(rows);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);

  useEffect(() => {
    setOverviewRows(rows);
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const refreshOverview = async () => {
      if (typeof fetch !== "function" || typeof AbortController === "undefined") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/scan/terminal?force_refresh=false", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json() as ScanTerminalResponse;
        if (!cancelled && Array.isArray(payload.rows)) {
          setOverviewRows(payload.rows);
          setLastScanAt(new Date());
        }
      } catch (error) {
        if ((error as { name?: string })?.name !== "AbortError") {
          // Keep the existing snapshot; overview refresh should never blank the terminal.
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshOverview();
    }, MARKET_OVERVIEW_REFRESH_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  const primaryRows = useMemo(
    () => overviewRows.filter((row) => row.is_primary_signal !== false),
    [overviewRows],
  );
  const regionStats = useMemo(
    () =>
      TRADING_REGIONS.map((region) => {
        const list = primaryRows.filter((row) => resolveTradingRegionKey(row) === region.key);
        const avgEdge = list.reduce((sum, row) => sum + numeric(row.edge_percent ?? row.signed_gap ?? row.gap), 0) / Math.max(list.length, 1);
        return {
          key: region.key,
          label: isEn ? region.labelEn : region.labelZh,
          contracts: list.length,
          tradable: list.filter((row) => row.tradable).length,
          heat: list.filter((row) => row.risk_level === "high" || numeric(row.current_temp) >= 30).length,
          avgEdge,
          liquidity: list.reduce((sum, row) => sum + rowLiquidity(row), 0),
        };
      }).filter((item) => item.contracts > 0),
    [isEn, primaryRows],
  );

  const topOpportunities = useMemo(
    () => [...primaryRows].sort((a, b) => rowOpportunityScore(b) - rowOpportunityScore(a)).slice(0, 12),
    [primaryRows],
  );
  const riskRows = useMemo(
    () =>
      primaryRows
        .filter((row) => isWatch(row) || numeric(row.edge_percent ?? row.signed_gap ?? row.gap) < 0 || row.closed || isStale(row))
        .sort((a, b) => numeric(a.edge_percent ?? a.signed_gap ?? a.gap) - numeric(b.edge_percent ?? b.signed_gap ?? b.gap))
        .slice(0, 12),
    [primaryRows],
  );
  const liquidityRows = useMemo(
    () => [...primaryRows].sort((a, b) => rowLiquidity(b) - rowLiquidity(a)).slice(0, 8),
    [primaryRows],
  );
  const tightSpreadRows = useMemo(
    () =>
      [...primaryRows]
        .filter((row) => rowSpread(row) > 0)
        .sort((a, b) => rowSpread(a) - rowSpread(b))
        .slice(0, 8),
    [primaryRows],
  );
  const whaleRows = useMemo(
    () => liquidityRows.slice(0, 6),
    [liquidityRows],
  );

  const [holderMap, setHolderMap] = useState<Record<string, HolderInfo>>({});
  useEffect(() => {
    whaleRows.forEach((row) => {
      const city = String(row.city || "").toLowerCase();
      if (!city || holderMap[city]?.loading || holderMap[city]?.holders) return;
      setHolderMap((prev) => ({ ...prev, [city]: { holders: null, loading: true } }));
      fetch(`/api/city/${encodeURIComponent(city)}/holders?limit=6`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
        .then(async (res) => {
          const json = await res.json() as { holders?: Holder[] };
          setHolderMap((prev) => ({ ...prev, [city]: { holders: json.holders || [], loading: false } }));
        })
        .catch(() => setHolderMap((prev) => ({ ...prev, [city]: { holders: null, loading: false } })));
    });
  }, [holderMap, whaleRows]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[1.1fr_1fr] grid-rows-[auto_1fr] gap-2">
      <Panel
        title={isEn ? "Regional Market Heat" : "区域市场热度"}
        className="col-span-2"
        actions={
          <span className="font-mono text-[10px] font-bold text-slate-400">
            {isEn ? "Scan: 10m" : "扫描：10分钟"}
            {lastScanAt ? ` · ${lastScanAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        }
      >
        <div className="grid grid-cols-4 gap-2 p-3">
          {regionStats.map((item) => (
            <button
              key={item.key}
              type="button"
              className="rounded border border-slate-200 bg-slate-50 p-3 text-left hover:bg-blue-50"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-black text-slate-800">{item.label}</div>
                <div className={clsx("font-mono text-xs font-black", edgeClass(item.avgEdge))}>{pct(item.avgEdge)}</div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
                {[
                  [isEn ? "Contracts" : "合约", item.contracts],
                  [isEn ? "Tradable" : "可交易", item.tradable],
                  [isEn ? "Heat" : "高温", item.heat],
                  [isEn ? "Liq" : "流动性", money(item.liquidity)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded border border-slate-200 bg-white px-1 py-1">
                    <div className="truncate text-[10px] font-black uppercase text-slate-400">{label}</div>
                    <div className="truncate font-mono font-black text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={isEn ? "Top Opportunities" : "Top Opportunities"}>
        <CompactRowsTable
          empty={isEn ? "No opportunities" : "暂无机会"}
          isEn={isEn}
          onSelectRow={onSelectRow}
          rows={topOpportunities}
        />
      </Panel>

      <Panel title={isEn ? "Risk / Watchlist" : "Risk / Watchlist"}>
        <CompactRowsTable
          empty={isEn ? "No risk rows" : "暂无风险项"}
          isEn={isEn}
          onSelectRow={onSelectRow}
          rows={riskRows}
        />
      </Panel>

      <Panel title={isEn ? "Liquidity Leaderboard" : "流动性排行"}>
        <CompactRowsTable
          empty={isEn ? "No liquidity rows" : "暂无流动性数据"}
          isEn={isEn}
          onSelectRow={onSelectRow}
          rows={liquidityRows}
        />
      </Panel>

      <div className="grid min-h-0 grid-rows-2 gap-2">
        <Panel title={isEn ? "Tightest Spreads" : "最低价差"}>
          <CompactRowsTable
            empty={isEn ? "No spread rows" : "暂无价差数据"}
            isEn={isEn}
            onSelectRow={onSelectRow}
            rows={tightSpreadRows}
            showSpread
          />
        </Panel>
        <Panel title={isEn ? "Whale Signals" : "大户持仓信号"}>
          <div className="divide-y divide-slate-100 text-[11px]">
            {whaleRows.map((row) => {
              const city = String(row.city || "").toLowerCase();
              const info = holderMap[city];
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelectRow(row)}
                  className="block w-full px-3 py-2 text-left hover:bg-blue-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-black text-slate-800">{rowName(row)}</span>
                    <span className="font-mono font-black text-blue-700">{money(rowLiquidity(row))}</span>
                  </div>
                  {info?.loading ? (
                    <div className="mt-1 text-[10px] text-slate-400">{isEn ? "Loading holders..." : "加载持仓..."}</div>
                  ) : info?.holders?.length ? (
                    <div className="mt-1 space-y-0.5">
                      {info.holders.slice(0, 2).map((holder, index) => (
                        <div key={`${city}-${index}`} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="truncate text-slate-500">{holderLabel(holder)}</span>
                          <span className="font-mono text-slate-700">
                            {holder.outcomeIndex === 0 ? "YES" : holder.outcomeIndex === 1 ? "NO" : ""}{" "}
                            {holder.amount != null ? Number(holder.amount).toFixed(0) : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] text-slate-400">{isEn ? "No holder data" : "无持仓数据"}</div>
                  )}
                </button>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}
