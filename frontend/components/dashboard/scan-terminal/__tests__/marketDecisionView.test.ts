import assert from "node:assert/strict";
import {
  buildMarketDecisionView,
  pickMarketBucketForWeatherCenter,
} from "@/components/dashboard/scan-terminal/city-card-decision-utils";
import type { MarketScan } from "@/lib/dashboard-types";

export function runTests() {
  const unavailable = buildMarketDecisionView({
    expectedHigh: 24,
    isEn: false,
    marketScan: { available: false },
    marketStatus: "ready",
    tempSymbol: "°C",
  });

  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.title, "市场价格暂不可用");
  assert.match(unavailable.reason, /暂无可交易价格/);
  assert.match(unavailable.reason, /天气判断仍可参考/);
  assert.doesNotMatch(unavailable.reason, /未接入|系统缺失|系统坏/);

  const mismatchedScan: MarketScan = {
    available: true,
    all_buckets: [
      {
        label: "40°C",
        temp: 40,
        unit: "C",
        model_probability: 0.2,
        market_price: 0.3,
        yes_buy: 0.31,
      },
    ],
    market_price: 0.3,
    model_probability: 0.55,
    yes_buy: 0.31,
  };
  const mismatched = buildMarketDecisionView({
    expectedHigh: 24,
    isEn: false,
    marketScan: mismatchedScan,
    marketStatus: "ready",
    tempSymbol: "°C",
  });

  assert.equal(pickMarketBucketForWeatherCenter(mismatchedScan, 24, "°C"), null);
  assert.equal(mismatched.status, "ready");
  assert.equal(mismatched.title, "市场温度桶需重新匹配");
  assert.equal(mismatched.edgeText, "--");
  assert.match(mismatched.reason, /温度桶与今日预计高点不够匹配/);

  const matched = buildMarketDecisionView({
    expectedHigh: 24.3,
    isEn: false,
    marketScan: {
      available: true,
      all_buckets: [
        {
          label: "24°C",
          temp: 24,
          unit: "C",
          model_probability: 0.64,
          market_price: 0.41,
          yes_buy: 0.42,
          slug: "tokyo-high-24c",
        },
      ],
      market_price: 0.41,
      model_probability: 0.64,
      yes_buy: 0.42,
    },
    marketStatus: "ready",
    tempSymbol: "°C",
  });

  assert.equal(matched.status, "ready");
  assert.equal(matched.bucketLabel, "24°C");
  assert.equal(matched.priceText, "42¢");
  assert.match(matched.reason, /模型概率 64\.0%/);
}
