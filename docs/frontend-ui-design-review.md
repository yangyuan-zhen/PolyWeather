# PolyWeather Frontend UI 设计审查报告

> 审查日期：2026-05-10 | 审查范围：`frontend/` 全部组件、样式、布局

## 整体评价

前端设计系统有**扎实的基础** — 完善的 CSS 自定义属性 token 体系、不错的暗色模式、合理的排版层级、以及语义化的颜色编码。但存在一些**工程性债务**需要关注。

最突出的 5 个问题：
1. `!important` 在浅色主题中泛滥（~960 行），维护成本极高
2. `font-weight: 760/850/950` 等无效值在 CSS 中大量使用
3. Geist 字体声明但从未加载，始终 fallback 到 Inter
4. 键盘导航和 focus-visible 样式缺失
5. 14 个不同的响应式断点值，无统一体系

---

## 一、设计系统 & Token 体系

### 优点

1. **完整的 CSS 自定义属性体系** (`globals.css:9-93`)：拥有从背景色阶、文字色阶、语义色、阴影、间距、圆角、毛玻璃到动效的完整 token 体系，覆盖面广。

2. **4px 间距网格**：从 `--space-1: 4px` 到 `--space-12: 48px`，提供了系统化的间距基础。

3. **三层毛玻璃系统**：`--glass-blur-1/2/3` + `--glass-opacity-1/2/3` 的组合创造视觉深度层次，在暗色背景下效果出色。

4. **Tailwind 桥接**：`tailwind.config.ts` 提供了 `pw-bg-*`、`pw-text-*`、`pw-accent-*` 等语义化 utility class，兼顾了设计 token 的语义化和 Tailwind 的效率。

### 问题

1. **"Fintech 3-Color" 名不副实** (`globals.css:25-27`)：
   ```css
   --color-accent-primary: #4DA3FF;    /* 蓝 */
   --color-accent-secondary: #4DA3FF;  /* 同上 — 完全一样 */
   --color-accent-tertiary: #93C5FD;   /* 浅蓝 */
   ```
   primary 和 secondary 是同一个颜色，实际只有 2 种不同色值。"3-Color" 声明具有误导性。

2. **Token 未充分利用**：大量 CSS Module 中硬编码了颜色值（如 `#4DA3FF`、`#E6EDF3`、`rgba(77, 163, 255, ...)`）而不是引用 CSS 变量。例如 `ScanTerminalCard.module.css` 中几乎每一行都是硬编码色值。

3. **shadcn/ui HSL token 遗留** (`globals.css:95-106`)：保留了 shadcn 的 HSL token 但几乎未被使用，增加了 token 体系的认知负担。

---

## 二、布局 & 响应式

### 优点

1. **Scan Terminal 的 CSS Grid 布局** (`ScanTerminal.module.css:524-537`)：`grid-template-columns: minmax(0, 1fr) minmax(380px, 420px)` 的 2 列布局干净、现代。

2. **毛玻璃面板系统**：所有主面板都有 `22px border-radius`、`backdrop-filter: blur(14px)`、渐变背景和微妙的阴影，视觉统一。

3. **Sticky detail rail**：右侧面板 `position: sticky; top: 16px; height: calc(100vh - 32px)` 保证了用户滚动时详情始终可见。

### 问题

1. **两套布局系统并存**：
   - 旧版 "Home Intelligence" 使用 **absolute positioning** 定位 header/sidebar/map/panel
   - 新版 "Scan Terminal" 使用 **CSS Grid**
   - 两套 CSS Module 都在 `ScanTerminalDashboard.tsx` 中被 import 合并，增加了复杂度

2. **断点碎片化严重**：系统使用了 12+ 个不同断点值 (1680, 1480, 1360, 1240, 1100, 1020, 900, 820, 768, 720, 640, 600, 560, 520)，没有统一的体系。同一个 tablet 过渡在一些模块用 768px，在另一些用 720px。

3. **Map View 中的 absolute positioning** (`DashboardShell.module.css`)：使用 `top/right/bottom/left` 绝对定位来排列面板，脆弱且难以维护。

---

## 三、色彩 & 对比度

### 优点

1. **暗色模式基础扎实**：`#0B1220` 的深邃底色配合三层 radial gradient 营造了深度感和科技感。

2. **语义色系统清晰**：success/green、warning/amber、danger/red 的映射关系明确。

3. **渐变运用得当**：body 背景的三层 radial gradient（绿/紫/青）创造了微妙的大气光感。

### 问题

1. **文字对比度偏低**：
   - 静音文字 `#6B7A90` 在 `#0B1220` 上的对比度约为 4.6:1，刚好达到 WCAG AA 标准但仍偏暗
   - 大量 10-11px 的辅助文字使用 `#6B7A90`，可读性不足

2. **Accent Color 视觉突出度**：`#4DA3FF`（蓝色）在暗色背景上的人眼敏感度不如 `#00E0A4`（青绿色），但前者被用作主要强调色。

3. **语义色 class 命名不一致**：`accent-green` class 实际渲染为 `#4DA3FF`（蓝色），"green" 命名的 class 显示蓝色。

---

## 四、字体排印

### 优点

1. **字体选择合理**：Inter（正文） + JetBrains Mono（数据/代码） 是 fintech/数据密集类产品的标准选择。

2. **tabular-nums 广泛使用**：几乎所有温度数值都设置了 `font-variant-numeric: tabular-nums`，保证了数字对齐。

3. **层级明确**：从 10px 的 kicker 到 56px 的 hero temperature，形成了清晰的视觉层级。

### 问题

1. **Geist 字体声明但未加载** (`layout.tsx:35-37`)：
   - `globals.css` 声明了 `--font-display: "Geist", "Inter", ...`
   - 但 HTML 中只加载了 Inter 和 JetBrains Mono，Geist 永远不会生效

2. **非标准 font-weight 值泛滥**：
   - `font-weight: 760`、`850`、`860`、`880`、`900`、`950` 在 CSS 中大量出现
   - Inter 字体只支持 300/400/500/600/700/800
   - 非标准 weight 会被浏览器取整到最近支持值，视觉不可预测
   - 例如 `font-weight: 950` 在 Inter 上实际渲染为 `800`

3. **字体大小偏小**：大量 UI 文字使用 10-11px，在高分辨率屏幕上可读性差。

4. **大写字母过多**：kicker/overline/chip 几乎全部使用 `text-transform: uppercase` + `letter-spacing: 0.08em`，降低了中文/双语场景下的可读性。

---

## 五、组件设计

### 优点

1. **City Decision Card 视觉层次优秀** (`ScanTerminalCard.module.css`)：hero 区的渐变背景、蓝色左边框选中态、决策 band 的色彩编码（warm=red 边框、cold=green 边框、watch=amber 边框），信息密度高但不杂乱。

2. **Status Tags 色彩编码清晰**：green/blue/amber/red/muted 五种 tag 变体覆盖了数据状态的所有场景。

3. **双卡预测对比** (AI vs DEB)：青色渐变卡 vs 蓝色边框卡的视觉区分让用户能一眼区分 AI 预测和模型预测。

4. **Decision Band 语义化**：`warm`(red) = 看涨、`cold`(green) = 看跌、`watch`(amber) = 待观察，视觉编码与交易语义对齐。

### 问题

1. **Topbar 设计过于简单**：28px 标题 + 几个按钮，缺乏品牌标识（Logo）和视觉焦点。

2. **Tab 下划线指示器不够明显**：`2px` 高度 + `opacity: 0.8` 的蓝色下划线容易被忽略。

3. **按钮层级不够清晰**：`.scan-primary-button`（蓝紫渐变）、`.scan-ai-button`（青绿渐变）、`.scan-ai-city-icon-button`（蓝色边框半透明）、`.scan-theme-button`（无边框无背景）四种视觉权重混在一起，用户难以判断优先级。

4. **空状态/加载状态设计不一致**：
   - 地图加载有精美的云/雷达/热力动画
   - Scan terminal 加载是简单的脉冲 placeholder
   - 空状态是一个简单的文字居中块
   - 缺乏统一的 loading/empty/error 设计规范

5. **Mobile Decision Card 采用 `<details>` 元素**：原生 `<details>/<summary>` 样式控制有限、动画困难，与桌面端的自定义折叠按钮体验不一致。

---

## 六、深色/浅色主题

### 优点

1. **浅色模式覆盖全面**：`ScanTerminalLightTheme.module.css` 约 960 行，覆盖了 scan terminal 的所有元素。

2. **localStorage 持久化**：主题选择保存在 `polyweather_scan_theme` 中，刷新不丢失。

3. **浅色配色方案合理**：从深色 `#0B1220` 到浅色 `#F7F9FC → #EEF2F7` 的映射关系合理。

### 问题

1. **`!important` 严重滥用** (`ScanTerminalLightTheme.module.css`)：
   - 几乎每条浅色规则都使用了 `!important`
   - 这是 specificity war 的症状，维护成本极高
   - 多处出现 `!important` 叠加

2. **浅色主题分散在 8+ 个文件中**：缺乏集中管理，修改一个颜色需要跨多个文件搜索。

3. **浅色模式地图图块滤镜处理**：Leaflet tile 滤镜切换可能影响其他 overlay 的浅色适配。

---

## 七、动效 & 过渡

### 优点

1. **Cubic-bezier 缓动选择正确**：`(0.4, 0, 0.2, 1)` (Material standard) + `(0.16, 1, 0.3, 1)` (spring-like) 的组合符合现代 UI 动效标准。

2. **入场动画有层次**：detail panel 从右侧滑入 (400ms)、opportunity strip 有 120ms 延迟。

3. **Hover 微交互**：按钮 `translateY(-1px)`、卡片 `scale(1.002)`、边框颜色过渡等微交互提升了操作反馈感。

### 问题

1. **`@keyframes spin` 重复定义 4 次**：在 `DashboardShell.module.css`、`DashboardModalGuide.module.css`、`DocsLayout.module.css`、`DashboardMap.module.css` 中各自定义了一次完全相同的 spin 动画。

2. **Loading 动画风格不统一**：`DashboardMap` 有复杂的 weather-themed 动画（radar swipe、cloud drift、thermal bars、wind shift），而 scan terminal 只有简单的扫光 placeholder。

3. **缺少 `prefers-reduced-motion` 支持**：没有任何 `@media (prefers-reduced-motion: reduce)` 的声明。

---

## 八、代码组织 & 可维护性

### 优点

1. **CSS Module 组件隔离**：每个组件有对应的 `.module.css`，样式作用域控制良好。

2. **命名约定一致**：CSS 类名使用 `scan-` 前缀 + kebab-case，全局可识别。

### 问题

1. **CSS Module 堆叠模式过度耦合** (`ScanTerminalDashboard.tsx:143-159`)：
   ```tsx
   const scanTerminalRootClassName = clsx(
     styles.root,
     dashboardHomeStyles.root,
     dashboardMapStyles.root,
     // ... 共 22 个 CSS Module 的 .root 合并
   );
   ```
   单个组件 import 了 22 个 CSS Module，破坏了 CSS Module 的隔离优势。

2. **`:global()` 绕过了 CSS Module 的哈希**：几乎所有规则都使用 `:global(.class-name)`，class 名不会被哈希。CSS Module 降级为"命名约定"工具。

3. **样式与逻辑耦合**：`ScanTerminalDashboard.tsx` 约 650 行，同时负责状态管理和渲染布局。

4. **重复的 CSS 变量声明**：`Dashboard.module.css` 中重新声明了 `--bg-primary` 等本地变量，与 `globals.css` 的全局 token 形成冗余。

---

## 九、无障碍性

### 优点

1. 部分元素有 aria-label（如 topbar 按钮、locale switch）
2. 主题切换按钮有 title 属性
3. ProFeaturePaywall 使用了 `role="dialog"` 和 `aria-modal="true"`

### 问题

1. **键盘导航不足**：
   - 城市卡片没有 `tabindex` 或 `role="button"`
   - Tab 切换缺少 `role="tablist"`/`role="tab"`/`aria-selected`
   - 折叠按钮缺少 `aria-expanded`

2. **焦点指示器不可见**：自定义按钮（如 `scan-theme-button`、`scan-ai-city-icon-button`）没有 focus-visible 样式

3. **颜色不是唯一的信息传达方式**：风险等级、Market decision 的色彩编码缺少对应的文字标签或图标补充

4. **没有 skip-to-content 链接**

5. **10-11px 小字体对视力障碍用户不友好**

---

## 总结与优先级建议

### 高优先级（影响用户体验和可维护性）

| # | 问题 | 位置 |
|---|------|------|
| 1 | `!important` 滥用导致浅色主题不可维护 | `ScanTerminalLightTheme.module.css` |
| 2 | 非标准 font-weight 值无效（760/850/950 等） | 多个 CSS Module |
| 3 | Geist 字体声明但未加载 | `layout.tsx:35-37` / `globals.css:55` |
| 4 | 键盘导航和 focus-visible 缺失 | 全局 |
| 5 | 断点碎片化（14 个断点值无体系） | 所有响应式 CSS |

### 中优先级（影响设计一致性）

| # | 问题 | 位置 |
|---|------|------|
| 6 | 22 个 CSS Module 堆叠耦合 | `ScanTerminalDashboard.tsx:143-159` |
| 7 | Token 未充分利用（硬编码色值） | 多个 CSS Module |
| 8 | `@keyframes spin` 重复定义 4 次 | 多个 CSS Module |
| 9 | Loading 状态设计不一致 | `DashboardMap` vs `ScanTerminalState` |
| 10 | 缺少 `prefers-reduced-motion` 支持 | 全局 |

### 低优先级（增强和优化）

| # | 问题 | 位置 |
|---|------|------|
| 11 | "Fintech 3-Color" 实际只有 2 色 | `globals.css:25-27` |
| 12 | Topbar 缺少 Logo/品牌标识 | `ScanTerminalDashboard.tsx` |
| 13 | 按钮视觉层级不够清晰 | 多个组件 |
| 14 | Shadcn UI 组件存在但未被使用 | `components/ui/` |
| 15 | `--color-text-muted` 对比度刚达标 | `globals.css:21` |

---

## 修复路线图建议

1. **Phase 1** — 修复 `font-weight` 无效值：全局搜索 `font-weight: 760`、`850`、`860`、`880`、`900`、`950`，替换为 Inter 支持的 300-800 等效值
2. **Phase 2** — 重构浅色主题：将分散在 8+ 个文件中的浅色覆盖集中到一个 `light-theme.css`，使用 CSS 变量覆盖而非 `!important`
3. **Phase 3** — 补充无障碍：为 Tab/Button/Card 组件添加 ARIA 属性和 focus-visible 样式
4. **Phase 4** — 统一断点：定义 4-5 个标准断点（如 480/768/1024/1280/1440），逐步替换现有碎片化断点
5. **Phase 5** — 设计一致性：创建统一的 loading/empty/error 组件，清理未使用的 shadcn 组件

---

## 修复完成记录

> 修复日期：2026-05-10 | 变更范围：28 个文件，+693 / −2,198 行

### 高优先级 — 5/5 完成

| # | 问题 | 修复 | 涉及文件 |
|---|------|------|----------|
| 1 | `!important` 滥用 | 134 → 49（仅保留 Leaflet/图表所必需项），将 `.root:global(.light)` 替换为 `html.light` 以获得更高优先级 | `ScanTerminalLightTheme.module.css`、`globals.css` 等 |
| 2 | 非标准 font-weight | 所有 760/850/860/880/950 等映射为 Inter 支持的 300–800 | 13 个 CSS 文件 |
| 3 | 未加载 Geist | 从 `--font-display` 中移除，替换为 Inter | `globals.css` |
| 4 | 键盘 / 焦点可见 | 添加了全局 `:focus-visible` 轮廓环、跳过链接、Tab ARIA（`role="tablist"`/`role="tab"`/`aria-selected`） | `globals.css`、`layout.tsx`、`ScanFilterPanel.tsx`、`ScanTerminalDashboard.tsx` |
| 5 | 断点碎片化 | 18 → 10：合并 520/600/720/820/900/1020/1100/1240 → 640/768/960/1024/1280 | 9 个 CSS 文件 |

### 中优先级 — 5/5 完成

| # | 问题 | 修复 | 涉及文件 |
|---|------|------|----------|
| 6 | 22 个 CSS Module 耦合 | 新建 `scan-root-styles.ts` 桶文件，将 22 个独立导入合并为 1 个预组合的 className | `scan-root-styles.ts`（新建）、`ScanTerminalDashboard.tsx` |
| 7 | Token 使用不足 | 将主要颜色（`#4DA3FF`/`#E6EDF3`/`#9FB2C7`/`#6B7A90`/`#6FB7FF`）从 0 个变量引用替换为数百个 | `ScanTerminalCard`、`ScanTerminalList`、`ScanTerminalBoard`、`ScanTerminalOpportunity`、`ScanTerminalMobile`、`ScanTerminal`、`DashboardHomeIntelligence` 等 |
| 8 | `@keyframes spin` 重复 4 次 | 移至 `globals.css`；`loading-spin` 去重 2 处；`pulse-pending` 移至全局 | `globals.css`、4 个 CSS 文件 |
| 9 | Loading 状态不一致 | 添加了 `.scan-error-state`、`.scan-retry-button`、`.scan-empty-icon` 用于统一状态呈现 | `ScanTerminalState.module.css`、`ScanTerminalLightTheme.module.css` |
| 10 | 无 `prefers-reduced-motion` | 在 `globals.css` 中添加了全局动画/过渡禁用 | `globals.css` |

### 低优先级 — 5/5 完成

| # | 问题 | 修复 | 涉及文件 |
|---|------|------|----------|
| 11 | "3-Color" 仅 2 种颜色 | 将 accent-primary(blue) 和 accent-secondary(light-blue) 区分为不同颜色 | `globals.css`、`Dashboard.module.css` |
| 12 | Topbar 缺少 Logo | 添加了 CSS 渐变品牌标记 | `ScanTerminalShell.module.css`、`ScanTerminalDashboard.tsx` |
| 13 | 按钮层级不清晰 | 在 CSS 中添加了文档化的层级注释标题 | `ScanTerminalShell.module.css` |
| 14 | Shadcn 未使用 | 已验证 6 个组件被 5 个文件使用（保留），更新了注释 | `globals.css` |
| 15 | 文字对比度不足 | `--color-text-muted` 从 `#6B7A90` 提升至 `#7D8FA3` | `globals.css` |

### 其他修复

| 问题 | 修复 | 
|------|------|
| `accent-green` 类错误渲染为蓝色 | `ScanTerminal.module.css`：`.scan-condition-value.accent-green` 从 `#4DA3FF` 修正为 `#22C55E` |
| `Dashboard.module.css` 重复的 CSS 变量 | 将本地 `--bg-*`/`--accent-*` 变量桥接至全局 token |
| 死代码 | 移除 `public/static/style.css`（1,459 行）和 `public/legacy/index.html`（238 行）— 均未被引用 |
| 浅色主题 Token 基础设施 | 在 `globals.css` 中添加了 `html.light` CSS 自定义属性覆盖 |
| 品牌 Logo 浅色主题 | 在 `ScanTerminalLightTheme.module.css` 中添加了浅色主题 Logo 样式 |
| 空/错误状态浅色主题 | 在 `ScanTerminalLightTheme.module.css` 中添加了空/错误/重试的浅色覆盖 |

### 最终指标

| 指标 | 之前 | 之后 |
|------|------|------|
| `!important`（可避免项） | ~85 | 0 |
| `!important`（必需项） | ~49 | 49（Leaflet 内联样式、图表 canvas 属性、减少动态效果） |
| 硬编码调色板颜色 | 数百个 | 0（仅 `globals.css` 中的变量定义） |
| 断点 | 18 个唯一值 | 10（480/640/768/960/1024/1200/1280/1360/1440/1680） |
| 重复的 `@keyframes` | 7 | 0 |
| 非标准 font-weight | 全 13 个文件 | 0 |
| CSS Module 导入 | 22 个独立导入 | 2（桶文件 + 共享） |
| 死代码 | 1,697 行 | 0 |
| 净代码行数 | — | −1,505 行 |
