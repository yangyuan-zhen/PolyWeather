"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ServiceResult = { ok: boolean; status?: number; latency_ms?: number; error?: string };
type HealthPayload = { ok: boolean; checked_at: string; services: Record<string, ServiceResult> };

const LABELS: Record<string, string> = {
  supabase: "Supabase",
  open_meteo: "Open-Meteo",
  metar: "METAR (AviationWeather)",
  knmi: "KNMI (Amsterdam)",
  madis: "MADIS (NOAA)",
  telegram: "Telegram Bot",
  jma: "JMA (日本)",
  mgm: "MGM (土耳其)",
  fmi: "FMI (芬兰)",
  kma: "KMA (韩国)",
  hko: "HKO (香港)",
  singapore_mss: "Singapore MSS",
  cwa: "CWA (台湾)",
  imgw: "IMGW (波兰)",
  polymarket_gamma: "Polymarket Gamma",
  polymarket_clob: "Polymarket CLOB",
  synoptic: "Synoptic Data",
  amos: "AMOS (韩国跑道)",
  amsc_awos: "AMSC AWOS (中国)",
  openweather: "OpenWeather",
  visualcrossing: "VisualCrossing",
  noaa_wrh: "NOAA WRH (美国结算)",
};

function StatusIcon({ svc }: { svc: ServiceResult }) {
  if (svc.ok) return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (svc.error && svc.error.includes("not configured")) return <AlertTriangle className="h-4 w-4 text-slate-500" />;
  return <XCircle className="h-4 w-4 text-red-400" />;
}

function StatusText({ svc }: { svc: ServiceResult }) {
  if (svc.ok) return <span className="text-xs text-emerald-400">{svc.latency_ms}ms</span>;
  if (svc.error && svc.error.includes("not configured")) return <span className="text-xs text-slate-500">未配置</span>;
  return <span className="text-xs text-red-400">{svc.error ?? "连接失败"}</span>;
}

export function HealthPageClient() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ops/health-check", { cache: "no-store" });
      if (!res.ok) { setError(`HTTP ${res.status}`); setLoading(false); return; }
      setData(await res.json());
    } catch (e) { setError(String(e).slice(0, 200)); }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  if (loading) return <div className="text-slate-400 animate-pulse">检测中...</div>;
  if (error) return <div className="text-red-400">加载失败: {error}</div>;
  if (!data) return <div className="text-slate-500">无数据</div>;

  const services = Object.entries(data.services);
  const okCount = services.filter(([, v]) => v.ok).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">
          API 状态{" "}
          <span className={data.ok ? "text-emerald-400" : "text-red-400"}>
            {data.ok ? "全部正常" : `${okCount}/${services.length} 正常`}
          </span>
        </h1>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-slate-500">{data.checked_at?.slice(11, 19) ?? ""}</span>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCcw className="h-3.5 w-3.5" /> 重新检测
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {services.map(([key, svc]) => (
          <Card key={key} className={svc.ok ? "border-emerald-400/20" : "border-red-400/30"}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">{LABELS[key] ?? key}</span>
                <StatusIcon svc={svc} />
              </div>
              <div className="flex items-center gap-2">
                {svc.status ? <span className="text-xs text-slate-500">HTTP {svc.status}</span> : null}
                <StatusText svc={svc} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
