export type DebTrainingMetric = {
  hit_rate?: number | null;
  mae?: number | null;
  total_days?: number;
};

export type DebTrainingWindow = {
  hit_rate?: number | null;
  mae?: number | null;
  samples?: number;
};

export type DebTrainingRecent = {
  recent_7d?: DebTrainingWindow | null;
  recent_14d?: DebTrainingWindow | null;
  trust_tier?: string | null;
  recommendation?: string | null;
};

export type DebTrainingCity = {
  city_id: string;
  name: string;
  deb?: DebTrainingMetric | null;
  deb_recent?: DebTrainingRecent | null;
};

export type DebRecentRankingRow = {
  cityId: string;
  name: string;
  hitRate: number;
  mae: number;
  samples: number;
  trustScore: number;
  usableScore: number;
};

function trustScore(tier?: string | null) {
  if (tier === "high") return 3;
  if (tier === "medium") return 2;
  if (tier === "low") return 1;
  return 0;
}

function usableScore(recommendation?: string | null) {
  if (recommendation === "primary") return 2;
  if (recommendation === "supporting") return 1;
  return 0;
}

function selectRecentWindow(recent?: DebTrainingRecent | null): DebTrainingWindow | null {
  const recent7 = recent?.recent_7d || null;
  if (Number(recent7?.samples || 0) > 0) return recent7;
  const recent14 = recent?.recent_14d || null;
  if (Number(recent14?.samples || 0) > 0) return recent14;
  return null;
}

export function buildDebRecentRankingRows(cities: DebTrainingCity[]): DebRecentRankingRow[] {
  return (cities || [])
    .filter((city) => city.deb)
    .map((city) => {
      const recentWindow = selectRecentWindow(city.deb_recent);
      return {
        cityId: city.city_id,
        name: city.name,
        hitRate: Number(
          (recentWindow?.hit_rate ?? city.deb?.hit_rate ?? 0).toFixed(1),
        ),
        mae: Number(
          (recentWindow?.mae ?? city.deb?.mae ?? 0).toFixed(2),
        ),
        samples: Number(recentWindow?.samples || 0),
        trustScore: trustScore(city.deb_recent?.trust_tier),
        usableScore: usableScore(city.deb_recent?.recommendation),
      };
    })
    .sort((a, b) => {
      if (a.usableScore !== b.usableScore) return b.usableScore - a.usableScore;
      if (a.trustScore !== b.trustScore) return b.trustScore - a.trustScore;
      if (a.hitRate !== b.hitRate) return b.hitRate - a.hitRate;
      if (a.samples !== b.samples) return b.samples - a.samples;
      return a.name.localeCompare(b.name);
    });
}
