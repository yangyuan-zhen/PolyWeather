import { buildDebRecentRankingRows } from "@/lib/deb-training-ranking";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const rows = buildDebRecentRankingRows([
    {
      city_id: "legacy",
      name: "Legacy Good",
      deb: { hit_rate: 95, mae: 0.9, total_days: 40 },
      deb_recent: {
        recent_7d: { hit_rate: 0, mae: 2.5, samples: 4 },
        recent_14d: { hit_rate: 15, mae: 2.1, samples: 8 },
        trust_tier: "low",
        recommendation: "context_only",
      },
    },
    {
      city_id: "usable",
      name: "Usable Recent",
      deb: { hit_rate: 40, mae: 1.4, total_days: 20 },
      deb_recent: {
        recent_7d: { hit_rate: 75, mae: 0.7, samples: 4 },
        recent_14d: { hit_rate: 70, mae: 0.8, samples: 8 },
        trust_tier: "high",
        recommendation: "primary",
      },
    },
    {
      city_id: "support",
      name: "Support Recent",
      deb: { hit_rate: 35, mae: 1.5, total_days: 20 },
      deb_recent: {
        recent_7d: { hit_rate: 50, mae: 1.2, samples: 4 },
        recent_14d: { hit_rate: 50, mae: 1.2, samples: 8 },
        trust_tier: "medium",
        recommendation: "supporting",
      },
    },
  ] as any);

  assert(rows[0].cityId === "usable", "high-trust recent DEB city should rank first");
  assert(rows[1].cityId === "support", "supporting recent DEB city should rank before low-trust legacy hit rate");
  assert(rows[2].cityId === "legacy", "low-trust historical performer should rank after usable recent cities");
  assert(rows[0].hitRate === 75, "ranking rows should use recent hit rate for chart value");
  assert(rows[0].mae === 0.7, "ranking rows should use recent MAE for chart value");
}
