"use client";

import { CloudSun, Gauge, Loader2, RefreshCw, Thermometer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CityDetail } from "@/lib/types";

type CityDetailPanelProps = {
  detail: CityDetail | null;
  loading: boolean;
  onRefresh: () => void;
};

export function CityDetailPanel({
  detail,
  loading,
  onRefresh,
}: CityDetailPanelProps) {
  if (!detail) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>City Detail</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-400">
          Select a city from the left list or map marker.
        </CardContent>
      </Card>
    );
  }

  const symbol = detail.temp_symbol || "C";
  const displayTemp =
    detail.current?.max_so_far != null
      ? detail.current.max_so_far
      : detail.current?.temp;

  return (
    <Card className="h-full">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xl uppercase tracking-wide text-cyan-200">
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
            Refresh
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
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
          <div className="mb-1 flex items-center gap-2 text-slate-400">
            <Thermometer className="h-4 w-4" />
            <span>Current / Max</span>
          </div>
          <div className="text-2xl font-semibold text-white">
            {displayTemp ?? "--"}
            {symbol}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            DEB: {detail.deb?.prediction ?? "--"}
            {symbol}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-slate-400">
              <CloudSun className="h-4 w-4" />
              <span>Cloud</span>
            </div>
            <p className="font-medium">{detail.current?.cloud_desc || "N/A"}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-slate-400">
              <Gauge className="h-4 w-4" />
              <span>Wind</span>
            </div>
            <p className="font-medium">
              {detail.current?.wind_speed_kt != null
                ? `${detail.current.wind_speed_kt} kt`
                : "N/A"}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
          <p className="mb-2 text-slate-400">AI Summary</p>
          <div
            className="max-h-44 overflow-y-auto leading-6 text-slate-200"
            dangerouslySetInnerHTML={{
              __html: detail.ai_analysis || "No analysis yet.",
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
