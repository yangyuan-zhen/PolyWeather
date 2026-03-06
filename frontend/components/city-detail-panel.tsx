"use client";

import { CloudSun, Gauge, Loader2, RefreshCw, Thermometer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/lib/i18n";
import type { CityDetail } from "@/lib/types";

type CityDetailPanelProps = {
  detail: CityDetail | null;
  loading: boolean;
  onRefresh: () => void;
  locale: Locale;
  text: {
    cityDetail: string;
    selectCityHint: string;
    refresh: string;
    currentMax: string;
    cloud: string;
    wind: string;
    topProb: string;
    noProb: string;
    aiSummary: string;
    noAnalysis: string;
  };
};

export function CityDetailPanel({
  detail,
  loading,
  onRefresh,
  locale,
  text,
}: CityDetailPanelProps) {
  if (!detail) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{text.cityDetail}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-400">
          {text.selectCityHint}
        </CardContent>
      </Card>
    );
  }

  const symbol = detail.temp_symbol || "C";
  const displayTemp =
    detail.current?.max_so_far != null
      ? detail.current.max_so_far
      : detail.current?.temp;
  const topProbabilities = (detail.probabilities?.distribution ?? [])
    .slice(0, 3)
    .map((item) => ({
      value: item.value,
      pct: Math.round(item.probability * 100),
    }));

  return (
    <Card className="glass h-full fade-up">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle
            className={`text-lg text-cyan-200 ${locale === "zh" ? "tracking-[0.06em]" : "uppercase tracking-[0.16em]"}`}
          >
            {detail.display_name}
          </CardTitle>
          <Button
            size="sm"
            variant="secondary"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            {text.refresh}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default">{detail.local_time || "--:--"}</Badge>
          {detail.current?.wu_settlement != null ? (
            <Badge variant="warning">WU {detail.current.wu_settlement}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-2xl border border-cyan-900/40 bg-gradient-to-br from-cyan-950/40 to-slate-900/80 p-4">
          <div className="mb-1 flex items-center gap-2 text-slate-300">
            <Thermometer className="h-4 w-4" />
            <span>{text.currentMax}</span>
          </div>
          <div className="text-3xl font-semibold text-white">
            {displayTemp ?? "--"}
            {symbol}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            DEB: {detail.deb?.prediction ?? "--"}
            {symbol}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-slate-400">
              <CloudSun className="h-4 w-4" />
              <span>{text.cloud}</span>
            </div>
            <p className="font-medium">{detail.current?.cloud_desc || "N/A"}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-slate-400">
              <Gauge className="h-4 w-4" />
              <span>{text.wind}</span>
            </div>
            <p className="font-medium">
              {detail.current?.wind_speed_kt != null
                ? `${detail.current.wind_speed_kt} kt`
                : "N/A"}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <p className="mb-2 text-slate-300">{text.topProb}</p>
          {topProbabilities.length === 0 ? (
            <p className="text-xs text-slate-500">{text.noProb}</p>
          ) : (
            <div className="space-y-2">
              {topProbabilities.map((item) => (
                <div key={item.value} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-200">
                      {item.value}
                      {symbol}
                    </span>
                    <span className="text-cyan-300">{item.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-400"
                      style={{ width: `${Math.max(item.pct, 6)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <p className="mb-2 text-slate-400">{text.aiSummary}</p>
          <div
            className="max-h-44 overflow-y-auto leading-6 text-slate-200"
            dangerouslySetInnerHTML={{
              __html: detail.ai_analysis || text.noAnalysis,
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
