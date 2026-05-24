# 终端城市表格按大洲分组 — 设计文档

日期：2026-05-25
状态：已确认

## 目标

将扫描终端（Scan Terminal）的城市列表从平铺表格改造为按时区分组、按交易信号优先的金融终端风格布局。

## 数据

所有字段已在 `/api/scan/terminal` 响应的 `ScanOpportunityRow` 中就绪，无需后端改动。

### 列 → 字段映射

| 列名 | 字段 | 类型 |
|------|------|------|
| City | `city`, `airport`, `local_time` | `string` |
| Obs | `current_temp` | `number \| null` |
| High | `current_max_so_far` | `number \| null` |
| DEB | `deb_prediction` | `number \| null` |
| Gap | `signed_gap` / `gap_to_target` | `number \| null` |
| Market | `midpoint`, `bid`, `ask` | `number \| null` |
| Edge | `edge_percent` | `number \| null` |
| Spr/Liq | `spread`, `book_liquidity` | `number \| null` |
| Signal | `signal_status`, `ai_decision` | `string \| null` |

## 时区分组

后端 `scan_terminal_filters.py` 按 UTC 偏移量划分 7 个交易区域：

| 排序 | 区域键 | 英文 | 中文 | UTC 条件 |
|------|--------|------|------|----------|
| 1 | east_asia | East Asia | 东亚 | >= +8 |
| 2 | southeast_asia | Southeast Asia | 东南亚 | >= +7 |
| 3 | central_asia | Central / South Asia | 中亚/南亚 | >= +5 |
| 4 | west_asia | West Asia / Middle East | 西亚/中东 | >= +3 |
| 5 | europe_africa | Europe / Africa | 欧洲/非洲 | >= 0 |
| 6 | south_america | Latin America | 拉美 | >= -5 |
| 7 | north_america | North America | 北美 | < -5 |

## 桌面端布局（≥ 768px）

### 虚拟分组："Active Signals"

在 7 个时区分组上方插入一个虚拟分组，聚合当前最重要的信号：

- 筛选条件：`ai_decision === "approve"`、`tradable === true`、`peak`、`rising`、`超预期`
- 标题行显示：城市数量、Hot 城市、更新时间
- 格式：`▼ Active Signals  活跃信号   6 · Hot: Tokyo · Updated 14:32`

### 时区分组标题行

- 显示：折叠箭头、中英文名、城市数、active 数、watch 数、本地时间
- 热门城市标注
- 格式：`▼ East Asia  东亚   5 · Active 2 · Watch 1 · LT 14:20`
- 可折叠，默认规则：
  - Active Signals 始终展开
  - 包含 active/watch 的时区展开
  - 无机会的时区折叠

### 表格行

- 9 列：City | Obs | High | DEB | Gap | Market | Edge | Spr/Liq | Signal
- Market 列显示价格格式：`Y 72¢` / `N 28¢`
- Signal 列显示：`◆ Active` / `● Watch` / `○ Closed` (文字+图标)

### Gap 列颜色语义

| 状态 | 颜色 | 含义 |
|------|------|------|
| 已突破/超预期 | 绿色 `#22c55e` | 对市场方向有利 |
| 接近目标未突破 | 橙色 `#f59e0b` | Peak Watch |
| 明显低于目标 | 蓝灰 `#64748b` | 尚不到位 |
| 追不上/时间不够 | 灰色 `#94a3b8` | 机会减弱 |
| 数据异常/风险 | 红色 `#ef4444` | 需关注 |

## 移动端布局（< 768px）

### Tab 栏

横向滚动，包含：`All | Active | 东亚 | 东南亚 | 中亚南亚 | 西亚 | 欧洲非洲 | 北美 | 拉美`

当前时区 Tab 默认选中。

### 信号卡片流

每张卡片两行信息：

```
┌──────────────────────────────┐
│ Tokyo · ◆ Active             │
│ Obs 28.1°C · Gap -0.8°C · Y 72¢ │
│ High 29.3°C · DEB 30.0°C    │
└──────────────────────────────┘
```

卡片字段：City、Signal、Obs、Gap、Market（第一行），High、DEB（第二行）

## 文件变更范围

### 主要文件

| 文件 | 变更 | 说明 |
|------|------|------|
| `components/dashboard/ScanTerminalDashboard.tsx` | 重构 | 拆分 `MarketTable`、`KoyfinWeatherTerminal`，新增分组和卡片组件 |
| `components/dashboard/scan-terminal/` | 新增 | `ContinentGroupHeader.tsx`、`ActiveSignalsGroup.tsx`、`MobileCityCard.tsx`、`MobileRegionTabs.tsx` |
| `components/dashboard/scan-terminal/continent-grouping.ts` | 新增 | 分组逻辑：按 `trading_region` 分桶、Active Signals 筛选、折叠状态管理 |
| `components/dashboard/scan-terminal/decision-utils.ts` | 修改 | 补充排序逻辑，Active Signals 置顶 |
| `components/dashboard/ScanTerminalDashboard.module.css` | 修改 | 新增分组标题行、卡片流、Tab 栏样式 |
| `components/dashboard/ScanTerminalLightTheme.module.css` | 新增/修改 | 浅色主题适配 |

### 不改的文件

- 后端 API：所有字段已就绪
- `ScanOpportunityRow` 类型定义：字段充足
- 数据获取 hooks：`useScanTerminalQuery` 保持不变

## 信号状态枚举

```
◆ Active   — approve / tradable + active
● Watch    — watch / monitor / peak_watch
○ Closed   — veto / closed / inactive
! Data     — 数据异常/缺失/延迟
```

## 验收标准

1. 桌面端：7 时区 + Active Signals 分组，可折叠，9 列表格
2. 移动端：Tab 切换 + 卡片流
3. Gap 颜色按语义映射，非简单正负色
4. Market 列显示价格格式（Y XX¢）
5. 默认折叠规则：Active Signals 展开、有机遇展开、无机遇折叠
6. 双主题（dark/light）CSS 适配
7. TypeScript 类型检查通过
8. `npm run build` 通过
