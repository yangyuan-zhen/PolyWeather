# 终端城市表格按大洲分组 — 实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 按任务逐步实施。

**目标:** 将扫描终端的平铺城市表格重构为按时区分组 + Active Signals 虚拟分组的金融终端风格，桌面端 9 列可折叠分组表格，移动端 Tab 切换 + 卡片流。

**架构:** 抽取分组逻辑到 `continent-grouping.ts`，新增 `ContinentGroupHeader`、`MobileCityCard`、`MobileRegionTabs` 三个子组件，重构 `ScanTerminalDashboard.tsx` 中的 `KoyfinWeatherTerminal` 和 `MarketTable`。数据字段全部就绪，后端零改动。

**技术栈:** React 19 + TypeScript + Tailwind CSS 3 + CSS Modules

---

### Task 1: 创建 continent-grouping.ts 分组逻辑

**文件:**
- 创建: `frontend/components/dashboard/scan-terminal/continent-grouping.ts`

这个文件负责所有分组逻辑：按 `trading_region` 分桶、Active Signals 筛选、折叠状态管理、Gap 颜色映射。

- [ ] **Step 1: 写入 continent-grouping.ts**

```typescript
import type { ScanOpportunityRow } from "@/lib/dashboard-types";

// 7 trading regions from backend scan_terminal_filters.py
export const TRADING_REGIONS = [
  { key: "east_asia", labelEn: "East Asia", labelZh: "东亚", sort: 1 },
  { key: "southeast_asia", labelEn: "Southeast Asia", labelZh: "东南亚", sort: 2 },
  { key: "central_asia", labelEn: "Central / South Asia", labelZh: "中亚 / 南亚", sort: 3 },
  { key: "west_asia", labelEn: "West Asia / Middle East", labelZh: "西亚 / 中东", sort: 4 },
  { key: "europe_africa", labelEn: "Europe / Africa", labelZh: "欧洲 / 非洲", sort: 5 },
  { key: "south_america", labelEn: "Latin America", labelZh: "拉美", sort: 6 },
  { key: "north_america", labelEn: "North America", labelZh: "北美", sort: 7 },
] as const;

export type TradingRegionKey = (typeof TRADING_REGIONS)[number]["key"];

export interface ContinentGroup {
  key: string; // "active_signals" | TradingRegionKey
  labelEn: string;
  labelZh: string;
  sort: number;
  rows: ScanOpportunityRow[];
  activeCount: number;
  watchCount: number;
  hotCity: string | null;
  localTimeRange: string | null;
}

export function isActiveSignal(row: ScanOpportunityRow): boolean {
  const decision = String(row.ai_decision || row.v4_metar_decision || "").toLowerCase();
  if (decision.includes("approve")) return true;
  if (row.tradable && row.active) return true;
  return false;
}

export function isWatchSignal(row: ScanOpportunityRow): boolean {
  const decision = String(row.ai_decision || row.v4_metar_decision || row.signal_status || "").toLowerCase();
  if (decision.includes("watch")) return true;
  if (decision.includes("monitor")) return true;
  if (!row.tradable && row.active) return true;
  return false;
}

export function isDeadSignal(row: ScanOpportunityRow): boolean {
  if (row.closed) return true;
  const decision = String(row.ai_decision || row.v4_metar_decision || "").toLowerCase();
  if (decision.includes("veto")) return true;
  return false;
}

export function getSignalState(row: ScanOpportunityRow): "active" | "watch" | "closed" | "data" {
  if (isDeadSignal(row)) return "closed";
  if (isActiveSignal(row)) return "active";
  if (isWatchSignal(row)) return "watch";
  return "data";
}

export function getSignalLabel(state: ReturnType<typeof getSignalState>, isEn: boolean): string {
  switch (state) {
    case "active": return isEn ? "◆ Active" : "◆ 活跃";
    case "watch": return isEn ? "● Watch" : "● 观察";
    case "closed": return isEn ? "○ Closed" : "○ 关闭";
    case "data": return isEn ? "! Data" : "! 数据";
  }
}

export type GapColor = "green" | "orange" | "slate" | "gray" | "red";

export function getGapColor(row: ScanOpportunityRow): GapColor {
  const gap = Number(row.signed_gap ?? row.gap_to_target);
  const edge = Number(row.edge_percent || 0);
  const spread = Number(row.spread || 0);
  const liq = Number(row.book_liquidity || row.market_liquidity || 0);

  if (!Number.isFinite(gap)) return "gray";
  if (liq <= 0 || spread > 20) return "red";
  if (gap >= 2) return "green";
  if (gap >= 0 && edge > 5) return "orange";
  if (gap >= 0) return "slate";
  if (gap < -5 || edge < -10) return "gray";
  return "slate";
}

export const GAP_COLOR_MAP: Record<GapColor, string> = {
  green: "text-emerald-600",
  orange: "text-amber-600",
  slate: "text-slate-500",
  gray: "text-slate-400",
  red: "text-red-500",
};

export function formatPrice(midpoint?: number | null, ask?: number | null, bid?: number | null): string {
  const m = Number(midpoint);
  if (Number.isFinite(m) && m > 0) {
    const cents = Math.round(m * 100);
    return `Y ${cents}¢`;
  }
  const a = Number(ask);
  if (Number.isFinite(a) && a > 0) {
    const cents = Math.round(a * 100);
    return `Y ${cents}¢`;
  }
  return "--";
}

export function formatSpreadLiquidity(spread?: number | null, liquidity?: number | null): string {
  const sp = Number(spread);
  const liq = Number(liquidity);
  const spStr = Number.isFinite(sp) ? `${Math.round(sp)}¢` : "--";
  const liqStr = Number.isFinite(liq)
    ? liq >= 1000
      ? `$${(liq / 1000).toFixed(1)}K`
      : `$${Math.round(liq)}`
    : "--";
  return `${spStr} / ${liqStr}`;
}

export function buildContinentGroups(rows: ScanOpportunityRow[], isEn: boolean): ContinentGroup[] {
  const regionMap = new Map<string, ScanOpportunityRow[]>();

  for (const row of rows) {
    const region = String(row.trading_region || "unknown").toLowerCase();
    if (!regionMap.has(region)) regionMap.set(region, []);
    regionMap.get(region)!.push(row);
  }

  const groups: ContinentGroup[] = [];

  // Active Signals virtual group
  const activeRows = rows.filter((r) => isActiveSignal(r));
  if (activeRows.length > 0) {
    const hotRow = activeRows.reduce((best, r) =>
      Number(r.edge_percent || 0) > Number(best.edge_percent || 0) ? r : best
    );
    groups.push({
      key: "active_signals",
      labelEn: "Active Signals",
      labelZh: "活跃信号",
      sort: 0,
      rows: activeRows,
      activeCount: activeRows.filter((r) => isActiveSignal(r)).length,
      watchCount: activeRows.filter((r) => isWatchSignal(r)).length,
      hotCity: hotRow?.city_display_name || hotRow?.city || null,
      localTimeRange: null,
    });
  }

  for (const region of TRADING_REGIONS) {
    const regionRows = regionMap.get(region.key) || [];
    if (regionRows.length === 0) continue;

    const activeCount = regionRows.filter((r) => isActiveSignal(r)).length;
    const watchCount = regionRows.filter((r) => isWatchSignal(r)).length;
    const sorted = [...regionRows].sort((a, b) =>
      Number(b.final_score || 0) - Number(a.final_score || 0)
    );
    const hotCity = sorted[0]?.city_display_name || sorted[0]?.city || null;

    // Compute local time range for this region
    const times = regionRows.map((r) => String(r.local_time || "").trim()).filter(Boolean);
    const ltRange = times.length >= 2
      ? `${times[0]}-${times[times.length - 1]}`
      : times[0] || null;

    groups.push({
      key: region.key,
      labelEn: region.labelEn,
      labelZh: region.labelZh,
      sort: region.sort,
      rows: regionRows,
      activeCount,
      watchCount,
      hotCity,
      localTimeRange: ltRange,
    });
  }

  // Sort: active_signals first, then by trading_region_sort
  groups.sort((a, b) => a.sort - b.sort);
  return groups;
}

export function getDefaultExpanded(groups: ContinentGroup[]): Set<string> {
  const expanded = new Set<string>();
  for (const g of groups) {
    if (g.key === "active_signals") {
      expanded.add(g.key);
    } else if (g.activeCount > 0 || g.watchCount > 0) {
      expanded.add(g.key);
    }
  }
  return expanded;
}
```

- [ ] **Step 2: 验证 TypeScript 类型**

```bash
cd frontend && npx tsc --noEmit src/components/dashboard/scan-terminal/continent-grouping.ts 2>&1 || true
```

预期：类型通过（可能有模块路径的错误，这些在组件集成后解决）。

- [ ] **Step 3: 提交**

```bash
git add frontend/components/dashboard/scan-terminal/continent-grouping.ts
git commit -m "新增终端大洲分组逻辑模块"
```

---

### Task 2: 创建 ContinentGroupHeader.tsx 分组标题行组件

**文件:**
- 创建: `frontend/components/dashboard/scan-terminal/ContinentGroupHeader.tsx`

- [ ] **Step 1: 写入组件**

```tsx
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ContinentGroup } from "@/components/dashboard/scan-terminal/continent-grouping";

export function ContinentGroupHeader({
  group,
  isExpanded,
  isEn,
  onToggle,
}: {
  group: ContinentGroup;
  isExpanded: boolean;
  isEn: boolean;
  onToggle: () => void;
}) {
  const label = isEn ? group.labelEn : group.labelZh;
  const parts: string[] = [`${group.rows.length}`];

  if (group.activeCount > 0) {
    parts.push(isEn ? `Active ${group.activeCount}` : `活跃 ${group.activeCount}`);
  }
  if (group.watchCount > 0) {
    parts.push(isEn ? `Watch ${group.watchCount}` : `观察 ${group.watchCount}`);
  }
  if (group.localTimeRange) {
    parts.push(`LT ${group.localTimeRange}`);
  }
  if (group.hotCity) {
    parts.push(isEn ? `Hot: ${group.hotCity}` : `热门: ${group.hotCity}`);
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center gap-2 border-b border-slate-200 bg-[#eef2f6] px-3 py-2 text-left hover:bg-[#e2e8f0] transition-colors"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center text-slate-400 group-hover:text-slate-600">
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </span>
      <span className="text-xs font-black uppercase tracking-wide text-slate-600">
        {label}
      </span>
      <span className="text-[11px] text-slate-400">
        {parts.join(" · ")}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/components/dashboard/scan-terminal/ContinentGroupHeader.tsx
git commit -m "新增终端大洲分组标题行组件"
```

---

### Task 3: 创建 MobileCityCard.tsx 移动端卡片组件

**文件:**
- 创建: `frontend/components/dashboard/scan-terminal/MobileCityCard.tsx`

- [ ] **Step 1: 写入组件**

```tsx
"use client";

import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  formatPrice,
  formatSpreadLiquidity,
  GAP_COLOR_MAP,
  getGapColor,
  getSignalLabel,
  getSignalState,
} from "@/components/dashboard/scan-terminal/continent-grouping";

function rowName(row: ScanOpportunityRow) {
  return row.city_display_name || row.display_name || row.city || "--";
}

function tempVal(value?: number | null, symbol?: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${n.toFixed(1)}${symbol || "°"}`;
}

export function MobileCityCard({
  isEn,
  onClick,
  row,
}: {
  isEn: boolean;
  onClick: (row: ScanOpportunityRow) => void;
  row: ScanOpportunityRow;
}) {
  const signal = getSignalState(row);
  const gapColor = GAP_COLOR_MAP[getGapColor(row)];

  return (
    <button
      type="button"
      onClick={() => onClick(row)}
      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:bg-blue-50/70 transition-colors"
    >
      {/* Row 1: City + Signal */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-bold text-slate-900">
          {rowName(row)}
        </span>
        <span className="shrink-0 text-xs font-black">
          <span className={signal === "active" ? "text-emerald-600" : signal === "watch" ? "text-amber-600" : signal === "closed" ? "text-slate-400" : "text-red-500"}>
            {getSignalLabel(signal, isEn)}
          </span>
        </span>
      </div>

      {/* Row 2: Obs · Gap · Market */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono font-bold">
          Obs {tempVal(row.current_temp, row.temp_symbol)}
        </span>
        <span className={gapColor}>
          Gap {tempVal(row.signed_gap ?? row.gap_to_target, row.temp_symbol)}
        </span>
        <span className="text-slate-600">
          {formatPrice(row.midpoint, row.ask, row.bid)}
        </span>
      </div>

      {/* Row 3: High · DEB */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>
          High {tempVal(row.current_max_so_far, row.temp_symbol)}
        </span>
        <span>
          DEB {tempVal(row.deb_prediction, row.temp_symbol)}
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/components/dashboard/scan-terminal/MobileCityCard.tsx
git commit -m "新增终端移动端城市卡片组件"
```

---

### Task 4: 创建 MobileRegionTabs.tsx 移动端 Tab 栏

**文件:**
- 创建: `frontend/components/dashboard/scan-terminal/MobileRegionTabs.tsx`

- [ ] **Step 1: 写入组件**

```tsx
"use client";

import clsx from "clsx";
import type { ContinentGroup } from "@/components/dashboard/scan-terminal/continent-grouping";

export function MobileRegionTabs({
  activeTab,
  groups,
  isEn,
  onSelectTab,
}: {
  activeTab: string;
  groups: ContinentGroup[];
  isEn: boolean;
  onSelectTab: (key: string) => void;
}) {
  return (
    <div className="flex overflow-x-auto border-b border-slate-200 bg-white px-2 no-scrollbar">
      {groups.map((g) => {
        const label = isEn ? g.labelEn : g.labelZh;
        const isActive = activeTab === g.key;
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => onSelectTab(g.key)}
            className={clsx(
              "shrink-0 px-3 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors",
              isActive
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {label}
            <span className="ml-1 text-[10px] text-slate-400">
              {g.activeCount > 0 ? `${g.activeCount}A` : g.rows.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/components/dashboard/scan-terminal/MobileRegionTabs.tsx
git commit -m "新增终端移动端大洲 Tab 栏组件"
```

---

### Task 5: 重构 ScanTerminalDashboard.tsx — 重写 MarketTable 为分组表格

**文件:**
- 修改: `frontend/components/dashboard/ScanTerminalDashboard.tsx` (替换 `MarketTable` 函数)

这个步骤将现有的 `MarketTable` 替换为支持分组标题行的新版本 `GroupedMarketTable`。

- [ ] **Step 1: 替换 MarketTable 组件 (第 245-323 行)**

删除旧 `MarketTable`，替换为：

```tsx
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  ContinentGroup,
  buildContinentGroups,
  formatPrice,
  formatSpreadLiquidity,
  GAP_COLOR_MAP,
  getDefaultExpanded,
  getGapColor,
  getSignalLabel,
  getSignalState,
} from "@/components/dashboard/scan-terminal/continent-grouping";

function GroupedMarketTable({
  groups,
  isEn,
  onSelect,
  selectedId,
}: {
  groups: ContinentGroup[];
  isEn: boolean;
  onSelect: (row: ScanOpportunityRow) => void;
  selectedId?: string | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const c = new Set<string>();
    const defaultExpanded = getDefaultExpanded(groups);
    for (const g of groups) {
      if (!defaultExpanded.has(g.key)) c.add(g.key);
    }
    return c;
  });

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[800px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-[#f5f7fa] text-left text-[11px] uppercase text-slate-500">
            <th className="px-3 py-2 font-black">City</th>
            <th className="px-2 py-2 text-right font-black">Obs</th>
            <th className="px-2 py-2 text-right font-black">High</th>
            <th className="px-2 py-2 text-right font-black">DEB</th>
            <th className="px-2 py-2 text-right font-black">Gap</th>
            <th className="px-2 py-2 text-right font-black">Market</th>
            <th className="px-2 py-2 text-right font-black">Edge</th>
            <th className="px-2 py-2 text-right font-black">Spr/Liq</th>
            <th className="px-3 py-2 font-black">Signal</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const isExpanded = !collapsed.has(group.key);
            const label = isEn ? group.labelEn : group.labelZh;
            return (
              <Fragment key={group.key}>
                {/* Group header row */}
                <tr className="border-b border-slate-200 bg-[#eef2f6]">
                  <td colSpan={9} className="p-0">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#e2e8f0] transition-colors"
                    >
                      <span className="grid h-4 w-4 place-items-center text-slate-400">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                      <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">
                        {label}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {group.rows.length} · {isEn ? "Active" : "活跃"} {group.activeCount} · {isEn ? "Watch" : "观察"} {group.watchCount}
                        {group.localTimeRange ? ` · LT ${group.localTimeRange}` : ""}
                        {group.hotCity ? ` · Hot: ${group.hotCity}` : ""}
                      </span>
                    </button>
                  </td>
                </tr>
                {/* Data rows */}
                {isExpanded &&
                  group.rows.map((row) => {
                    const signal = getSignalState(row);
                    const gapColor = GAP_COLOR_MAP[getGapColor(row)];
                    return (
                      <tr
                        key={row.id}
                        className={clsx(
                          "cursor-pointer border-b border-slate-100 hover:bg-blue-50/70",
                          selectedId === row.id && "bg-blue-50"
                        )}
                        onClick={() => onSelect(row)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-bold text-slate-900">{rowName(row)}</div>
                          <div className="truncate text-[11px] text-slate-500">
                            {row.airport || ""}{row.local_time ? ` · ${row.local_time}` : ""}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-bold">
                          {temp(row.current_temp, row.temp_symbol)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {temp(row.current_max_so_far, row.temp_symbol)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {temp(row.deb_prediction, row.temp_symbol)}
                        </td>
                        <td className={clsx("px-2 py-2 text-right font-mono font-bold", gapColor)}>
                          {temp(row.signed_gap ?? row.gap_to_target, row.temp_symbol)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {formatPrice(row.midpoint, row.ask, row.bid)}
                        </td>
                        <td className={clsx("px-2 py-2 text-right font-mono font-bold", edgeClass(row.edge_percent))}>
                          {pct(row.edge_percent)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[11px]">
                          {formatSpreadLiquidity(row.spread, row.book_liquidity ?? row.market_liquidity)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={clsx(
                            "text-[11px] font-black",
                            signal === "active" ? "text-emerald-600" :
                            signal === "watch" ? "text-amber-600" :
                            signal === "closed" ? "text-slate-400" : "text-red-500"
                          )}>
                            {getSignalLabel(signal, isEn)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

需要在本文件顶部新增 `import { Fragment, ... }` from react。

- [ ] **Step 2: 更新 import 语句 (文件第 1 行)**

将 `import { useEffect, useMemo, useState } from "react";` 改为：
```tsx
import { Fragment, useEffect, useMemo, useState } from "react";
```

- [ ] **Step 3: 验证 TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: 提交**

```bash
git add frontend/components/dashboard/ScanTerminalDashboard.tsx
git commit -m "终端表格重构为9列时区分组布局：新增 City/Obs/High/DEB/Gap/Market/Edge/SprLiq/Signal 列"
```

---

### Task 6: 重构 KoyfinWeatherTerminal — 接入分组逻辑

**文件:**
- 修改: `frontend/components/dashboard/ScanTerminalDashboard.tsx` (修改 `KoyfinWeatherTerminal`)

在 `KoyfinWeatherTerminal` 中引入 `buildContinentGroups`，将左列 `MarketTable` 替换为 `GroupedMarketTable`，中列 `MarketTable` 替换为 `GroupedMarketTable`，右列 Watchlist 保留列表展示。

- [ ] **Step 1: 修改 KoyfinWeatherTerminal 中的左列表格部分 (第 460-491 行)**

找到左列 `<Panel title="Weather Contracts">` 内的 `<MarketTable>`，替换为：

```tsx
<Panel title={isEn ? "Weather Contracts" : "天气合约"}>
  <div className="grid grid-cols-3 border-b border-slate-200 text-center">
    <div className="p-3">
      <div className="text-[11px] font-black uppercase text-slate-500">
        {isEn ? "Rows" : "行数"}
      </div>
      <div className="font-mono text-xl font-black">{rows.length}</div>
    </div>
    <div className="border-x border-slate-200 p-3">
      <div className="text-[11px] font-black uppercase text-slate-500">
        Avg Edge
      </div>
      <div className={clsx("font-mono text-xl font-black", edgeClass(avgEdge))}>
        {pct(avgEdge)}
      </div>
    </div>
    <div className="p-3">
      <div className="text-[11px] font-black uppercase text-slate-500">
        Liquidity
      </div>
      <div className="font-mono text-xl font-black">
        {money(totalLiquidity)}
      </div>
    </div>
  </div>
  <GroupedMarketTable
    groups={continentGroups}
    isEn={isEn}
    selectedId={selectedRow?.id}
    onSelect={setSelectedRow}
  />
</Panel>
```

- [ ] **Step 2: 替换中列 MarketTable (第 600-606 行)**

```tsx
<Panel title={isEn ? "All Contracts" : "全部合约"}>
  <GroupedMarketTable
    groups={continentGroups}
    isEn={isEn}
    selectedId={selectedRow?.id}
    onSelect={setSelectedRow}
  />
</Panel>
```

- [ ] **Step 3: 在 KoyfinWeatherTerminal 中计算 continentGroups**

在组件内部，紧接 `const selectedLabel = ...` 之后添加：

```tsx
const continentGroups = useMemo(
  () => buildContinentGroups(rows, isEn),
  [rows, isEn]
);
```

- [ ] **Step 4: 提交**

```bash
git add frontend/components/dashboard/ScanTerminalDashboard.tsx
git commit -m "终端三列布局接入大洲分组数据"
```

---

### Task 7: 实现移动端响应式布局 — Tab + 卡片流

**文件:**
- 修改: `frontend/components/dashboard/ScanTerminalDashboard.tsx` (修改 `KoyfinWeatherTerminal` main 区域)

在 `<main>` 内，用 `useMediaQuery` 或 Tailwind 响应式类区分桌面/移动端布局。移动端显示 `MobileRegionTabs` + `MobileCityCard` 列表。

- [ ] **Step 1: 在 KoyfinWeatherTerminal 中添加移动端状态和渲染**

在组件顶部添加：
```tsx
const [mobileTab, setMobileTab] = useState<string>("active_signals");
```

在 `continentGroups` 计算后添加：
```tsx
const mobileActiveGroup = useMemo(
  () => continentGroups.find((g) => g.key === mobileTab) || continentGroups[0],
  [continentGroups, mobileTab]
);

useEffect(() => {
  if (continentGroups.length > 0 && !continentGroups.find((g) => g.key === mobileTab)) {
    setMobileTab(continentGroups[0].key);
  }
}, [continentGroups, mobileTab]);
```

- [ ] **Step 2: 修改 main 区域为响应式双布局 (第 458-673 行)**

在 `<main>` 中包裹条件渲染：

```tsx
<main className="min-h-0 flex-1 overflow-auto p-2">
  {/* Mobile layout */}
  <div className="flex flex-col gap-2 lg:hidden">
    <MobileRegionTabs
      activeTab={mobileTab}
      groups={continentGroups}
      isEn={isEn}
      onSelectTab={setMobileTab}
    />
    <div className="space-y-2 px-1">
      {mobileActiveGroup?.rows.map((row) => (
        <MobileCityCard
          key={row.id}
          row={row}
          isEn={isEn}
          onClick={setSelectedRow}
        />
      ))}
    </div>
  </div>

  {/* Desktop layout (existing 3-column grid) */}
  <div className="hidden min-h-full grid-cols-1 gap-2 lg:grid xl:grid-cols-[1.12fr_1.6fr_1.1fr]">
    {/* ... existing 3 columns unchanged ... */}
  </div>
</main>
```

现有的三列布局代码放入 `{/* Desktop layout */}` 块中，用 `hidden lg:grid` 控制显示。

- [ ] **Step 3: 验证 TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: 提交**

```bash
git add frontend/components/dashboard/ScanTerminalDashboard.tsx
git commit -m "终端新增移动端 Tab+卡片流响应式布局"
```

---

### Task 8: 添加 CSS 样式 — 分组行和移动端卡片

**文件:**
- 创建: `frontend/components/dashboard/ScanTerminalContinent.module.css`
- 修改: `frontend/components/dashboard/scan-root-styles.ts`

- [ ] **Step 1: 写入 CSS Module**

```css
/* ScanTerminalContinent.module.css */

.root {
  --gap-green: #16a34a;
  --gap-orange: #ea580c;
  --gap-slate: #475569;
  --gap-gray: #94a3b8;
  --gap-red: #dc2626;
}

/* Group header */
.groupHeader {
  background: #eef2f6;
  border-bottom: 1px solid #cbd5e1;
}
.groupHeader:hover {
  background: #e2e8f0;
}

/* Mobile: hide scrollbar on tab bar */
.mobileTabs {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.mobileTabs::-webkit-scrollbar {
  display: none;
}

/* Mobile card */
.mobileCard {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.mobileCard:hover {
  background: #f0f7ff;
}

/* Signal badge */
.signalActive {
  color: #059669;
}
.signalWatch {
  color: #d97706;
}
.signalClosed {
  color: #94a3b8;
}
.signalData {
  color: #dc2626;
}

/* Light theme */
:global(html.light) .groupHeader {
  background: #f8fafc;
  border-bottom-color: #e2e8f0;
}
:global(html.light) .groupHeader:hover {
  background: #f1f5f9;
}
:global(html.light) .mobileCard {
  background: #ffffff;
  border-color: #e2e8f0;
}
```

- [ ] **Step 2: 注册到 scan-root-styles.ts barrel**

读取 `frontend/components/dashboard/scan-root-styles.ts`，追加：
```typescript
import sContinent from "@/components/dashboard/ScanTerminalContinent.module.css";
// ... add sContinent.root to the barrel export
```

- [ ] **Step 3: 提交**

```bash
git add frontend/components/dashboard/ScanTerminalContinent.module.css frontend/components/dashboard/scan-root-styles.ts
git commit -m "新增终端大洲分组与移动端卡片样式"
```

---

### Task 9: 最终验证与构建

- [ ] **Step 1: TypeScript 类型检查**

```bash
cd frontend && npx tsc --noEmit
```
预期：0 errors。

- [ ] **Step 2: 生产构建**

```bash
cd frontend && npm run build
```
预期：✓ Compiled successfully，66 pages generated。

- [ ] **Step 3: 启动 dev server 验证 UI**

```bash
cd frontend && npm run dev
```

打开 http://localhost:3000/terminal 验证：
- 桌面端：Active Signals 展开显示，时区分组折叠/展开，9 列表格
- 移动端：Tab 切换流畅，卡片流显示正常
- 双主题切换无样式错误

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "终端大洲分组功能验证通过"
```
