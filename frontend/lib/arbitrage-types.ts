// 套利对比（DEB 概率 vs Polymarket Yes 价格）类型契约。
// ArbitrageOverview / ArbitrageBucket 与后端 GET /api/arbitrage/overview 的
// wire 格式（snake_case）一一对应；ArbitrageWindow 为前端本地滑窗计算结果。

export interface ArbitrageBucket {
  label: string; // "36°C" / "31°C or below" / "41°C or higher"
  value: number; // 排序锚点（温度升序）
  isTail: "below" | "higher" | null; // 边界桶标记，中间档为 null
  deb_probability: number; // DEB P(档位)，聚合后（0-1 概率分数）
  market_yes_cents: number | null; // Polymarket Yes 价格（¢）
  market_no_cents: number | null; // Polymarket No 价格（¢）
  market_volume_usd: number | null; // 交易量（USD）
  market_liquidity_usd: number | null; // 流动性（USD）
  market_slug: string | null;
  market_url: string | null;
}

export interface ArbitrageOverview {
  city: string;
  generated_at: string; // ISO-8601
  engine: "deb_normal" | "legacy" | string;
  temp_symbol: string; // "°C" / "°F"
  market_available: boolean;
  total_market_yes_sum: number | null; // 全市场 Yes 价格总和（¢），<100 提示严格套利
  buckets: ArbitrageBucket[]; // 全市场档位，温度升序
  error: string | null;
}

// 套利可用城市列表（GET /api/arbitrage/cities）wire 格式。
export interface ArbitrageCity {
  key: string; // 城市 key（如 "shanghai"）
  display_name: string; // 后端展示名（如 "Shanghai"）
}

export interface ArbitrageCitiesResponse {
  cities: ArbitrageCity[];
  fallback: boolean; // 后端是否回退到静态列表
  generated_at: string; // ISO-8601
}

// 多城市批量概览（GET /api/arbitrage/overview-batch）wire 格式。
// details 按城市 key 映射到单城市 ArbitrageOverview；慢城/失败城落入
// errors 或 missing，此时 partial=true（前端应展示已有卡片并提示部分加载）。
export interface ArbitrageBatchOverviewResponse {
  cities: string[]; // 请求的城市列表（原始顺序，去重后）
  details: Record<string, ArbitrageOverview>;
  errors: Record<string, string>;
  missing: string[];
  partial: boolean;
  timeout?: boolean; // Next proxy 15s 超时降级标记
  _meta?: {
    response_source: string;
    city_durations_ms?: Record<string, number>;
    requested_count?: number;
    completed_count?: number;
    missing_count?: number;
    error_count?: number;
  };
}

export interface ArbitrageWindow {
  startIndex: number;
  endIndex: number; // buckets 下标（inclusive）
  labels: string[]; // 窗口档位标签（温度升序）
  debSum: number; // ΣP（0-1 概率分数）
  marketSum: number; // ΣYes（¢）
  edge: number; // debSum - marketSum / 100（概率分数；×100 后为百分点）
  isTop3: boolean; // 是否为默认高亮窗口
}
