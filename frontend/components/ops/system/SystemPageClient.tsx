"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, ShieldCheck, Database, Cpu, HardDrive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { SystemStatusPayload, HealthPayload } from "@/types/ops";

export function SystemPageClient() {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [status, setStatus] = useState<SystemStatusPayload | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [h, s] = await Promise.all([
        opsApi.health(),
        opsApi.systemStatus() as Promise<SystemStatusPayload>,
      ]);
      setHealth(h);
      setStatus(s);
    } catch (e) {
      setError(String(e).slice(0, 200));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return <div className="text-slate-400 animate-pulse">加载中...</div>;
  }

  if (error) {
    return <div className="text-red-400">加载失败: {error}</div>;
  }

  const dbOk = status?.db?.ok ?? health?.db?.ok;
  const cacheAnalysis = status?.cache?.analysis;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">系统状态</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      {/* Health badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ShieldCheck className={`h-5 w-5 ${health?.status === "ok" ? "text-emerald-400" : "text-red-400"}`} />
            <div>
              <div className="text-xs text-slate-500">Health</div>
              <div className="text-sm font-bold text-white">{health?.status ?? "—"}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Database className={`h-5 w-5 ${dbOk ? "text-emerald-400" : "text-red-400"}`} />
            <div>
              <div className="text-xs text-slate-500">Database</div>
              <div className="text-sm font-bold text-white">{dbOk ? "OK" : "FAIL"}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <HardDrive className="h-5 w-5 text-cyan-400" />
            <div>
              <div className="text-xs text-slate-500">存储模式</div>
              <div className="text-sm font-bold text-white">{status?.state_storage_mode ?? "—"}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Cpu className="h-5 w-5 text-cyan-400" />
            <div>
              <div className="text-xs text-slate-500">概率引擎</div>
              <div className="text-sm font-bold text-white">{status?.probability?.engine_mode ?? "—"}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Features & Integrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>功能开关</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {status?.features
                ? Object.entries(status.features).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-slate-400">{k}</span>
                      <Badge variant={v ? "default" : "secondary"}>{String(v)}</Badge>
                    </div>
                  ))
                : <span className="text-slate-500">无数据</span>}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>集成状态</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {status?.integrations
                ? Object.entries(status.integrations).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-slate-400">{k}</span>
                      <Badge variant={v ? "default" : "secondary"}>{String(v)}</Badge>
                    </div>
                  ))
                : <span className="text-slate-500">无数据</span>}
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Cache Analysis */}
      {cacheAnalysis ? (
        <Card>
          <CardHeader>
            <CardTitle>缓存分析</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-slate-500">总请求</div>
                <div className="text-lg font-bold text-white">{cacheAnalysis.total_requests ?? 0}</div>
              </div>
              <div>
                <div className="text-slate-500">命中</div>
                <div className="text-lg font-bold text-emerald-400">{cacheAnalysis.cache_hits ?? 0}</div>
              </div>
              <div>
                <div className="text-slate-500">未命中</div>
                <div className="text-lg font-bold text-amber-400">{cacheAnalysis.cache_misses ?? 0}</div>
              </div>
              <div>
                <div className="text-slate-500">命中率</div>
                <div className="text-lg font-bold text-cyan-400">
                  {cacheAnalysis.hit_rate != null ? `${(cacheAnalysis.hit_rate * 100).toFixed(0)}%` : "—"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* DB Path */}
      {status?.db?.db_path ? (
        <Card>
          <CardHeader>
            <CardTitle>数据库路径</CardTitle>
          </CardHeader>
          <CardContent>
            <code className="text-xs text-blue-300 bg-black/40 rounded-lg px-3 py-2 block truncate">
              {status.db.db_path}
            </code>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
