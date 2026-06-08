"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, RefreshCcw, ShieldCheck, Database, Cpu, HardDrive, RadioTower } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type {
  ObservationCollectorStatusPayload,
  SourceHealthPayload,
  SystemStatusPayload,
  HealthPayload,
} from "@/types/ops";

function sourceStatusTone(status?: string) {
  if (status === "fresh") return "text-emerald-500";
  if (status === "expected_wait") return "text-blue-500";
  if (status === "delayed") return "text-amber-500";
  if (status === "stale" || status === "missing") return "text-red-500";
  return "text-slate-500";
}

function sourceStatusLabel(status?: string) {
  if (status === "fresh") return "正常";
  if (status === "expected_wait") return "等待更新";
  if (status === "delayed") return "延迟";
  if (status === "stale") return "断线";
  if (status === "missing") return "缺失";
  return "未知";
}

function collectorStatusTone(status?: string) {
  if (status === "ok") return "text-emerald-500";
  if (status === "due") return "text-blue-500";
  if (status === "cooldown") return "text-amber-500";
  if (status === "failed" || status === "never_run") return "text-red-500";
  return "text-slate-500";
}

function collectorStatusLabel(status?: string) {
  if (status === "ok") return "正常";
  if (status === "due") return "到期";
  if (status === "cooldown") return "冷却";
  if (status === "failed") return "失败";
  if (status === "never_run") return "未采集";
  return "未知";
}

function formatAge(ageMin?: number | null) {
  if (ageMin == null) return "—";
  if (ageMin < 60) return `${Math.round(ageMin)}m`;
  return `${(ageMin / 60).toFixed(1)}h`;
}

function formatSeconds(seconds?: number | null) {
  if (seconds == null) return "—";
  if (seconds <= 0) return "已到期";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatLatency(ms?: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "—";
  return value.replace("T", " ").replace("Z", "").slice(0, 19);
}

function sourceReasonLabel(reason?: string | null) {
  const key = String(reason || "").trim().toLowerCase();
  if (key === "observation_time_missing") return "观测时间缺失";
  if (key === "expected_source_not_present_in_cached_detail") return "缓存详情未包含预期来源";
  if (key === "past_expected_cadence") return "超过预期更新节奏";
  if (key === "within_expected_cadence") return "仍在预期更新窗口";
  if (key === "missing_observation") return "缺少观测值";
  if (key === "no_cached_detail") return "缺少城市详情缓存";
  return key || "—";
}

function formatOpsValue(value: unknown) {
  if (typeof value === "boolean") {
    return { label: value ? "TRUE" : "FALSE", active: value };
  }
  if (typeof value === "string" || typeof value === "number") {
    return { label: String(value), active: Boolean(value) };
  }
  if (Array.isArray(value)) {
    return { label: `${value.length} 项`, active: value.length > 0 };
  }
  if (value && typeof value === "object") {
    const entries = Object.values(value as Record<string, unknown>);
    const enabled = entries.filter(Boolean).length;
    return { label: `${enabled}/${entries.length} 已配置`, active: enabled > 0 };
  }
  return { label: "—", active: false };
}

export function SystemPageClient() {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [status, setStatus] = useState<SystemStatusPayload | null>(null);
  const [sourceHealth, setSourceHealth] = useState<SourceHealthPayload | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<ObservationCollectorStatusPayload | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [h, s, sh, cs] = await Promise.all([
        opsApi.health(),
        opsApi.systemStatus() as Promise<SystemStatusPayload>,
        opsApi.sourceHealth(80) as Promise<SourceHealthPayload>,
        opsApi.observationCollectorStatus(200) as Promise<ObservationCollectorStatusPayload>,
      ]);
      setHealth(h);
      setStatus(s);
      setSourceHealth(sh);
      setCollectorStatus(cs);
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
  const collectorIssues = (collectorStatus?.entries || [])
    .filter((entry) => {
      const state = String(entry.status || "");
      return ["failed", "cooldown", "never_run", "due"].includes(state) || (entry.failure_count ?? 0) > 0;
    })
    .slice(0, 12);
  const sourceIssues = (sourceHealth?.cities || [])
    .flatMap((city) =>
      (city.sources || [])
        .filter((source) => ["delayed", "stale", "missing", "unknown"].includes(String(source.status || "")))
        .map((source) => ({ city: city.city, source })),
    )
    .slice(0, 10);

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
                ? Object.entries(status.features).map(([k, v]) => {
                    const formatted = formatOpsValue(v);
                    return (
                      <div key={k} className="flex justify-between">
                        <span className="text-slate-400">{k}</span>
                        <Badge variant={formatted.active ? "default" : "secondary"}>{formatted.label}</Badge>
                      </div>
                    );
                  })
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
                ? Object.entries(status.integrations).map(([k, v]) => {
                    const formatted = formatOpsValue(v);
                    return (
                      <div key={k} className="flex justify-between">
                        <span className="text-slate-400">{k}</span>
                        <Badge variant={formatted.active ? "default" : "secondary"}>{formatted.label}</Badge>
                      </div>
                    );
                  })
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
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
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
                <div className="text-slate-500">强制刷新</div>
                <div className="text-lg font-bold text-blue-500">{cacheAnalysis.force_refresh_requests ?? 0}</div>
              </div>
              <div>
                <div className="text-slate-500">命中率</div>
                <div className="text-lg font-bold text-cyan-400">
                  {cacheAnalysis.hit_rate != null ? `${(cacheAnalysis.hit_rate * 100).toFixed(0)}%` : "—"}
                </div>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              这里统计当前后端进程的分析缓存请求；部署重启后会重新累计。
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-500" />
            观测采集器
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {["ok", "due", "cooldown", "failed", "never_run"].map((key) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">{collectorStatusLabel(key)}</div>
                <div className={`text-lg font-black ${collectorStatusTone(key)}`}>
                  {collectorStatus?.status_counts?.[key] ?? 0}
                </div>
              </div>
            ))}
          </div>

          {(collectorStatus?.sources || []).length ? (
            <div className="mb-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-2 xl:grid-cols-3">
              {(collectorStatus?.sources || []).map((source) => (
                <div key={source.source} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-black text-slate-800">{source.source}</span>
                    <span className={`font-bold ${collectorStatusTone(source.worst_status)}`}>
                      {collectorStatusLabel(source.worst_status)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
                    <span>城市 {source.city_count ?? 0}</span>
                    <span>间隔 {source.min_interval_sec ?? source.interval_sec ?? "—"}s</span>
                    <span>失败 {source.failure_count ?? 0}</span>
                    <span>冷却 {source.cooldown_count ?? 0}</span>
                    <span>延迟 {formatLatency(source.avg_latency_ms)}</span>
                    <span title={source.last_success_at || ""}>成功 {formatTimestamp(source.last_success_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              暂无后台采集状态；collector 首次写入后会显示每个 source/city 的最近采集时间、失败次数、延迟和冷却状态。
            </div>
          )}

          {collectorIssues.length ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">城市</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">最近成功</th>
                    <th className="px-3 py-2">失败次数</th>
                    <th className="px-3 py-2">延迟</th>
                    <th className="px-3 py-2">下次</th>
                    <th className="px-3 py-2">错误</th>
                  </tr>
                </thead>
                <tbody>
                  {collectorIssues.map((entry) => (
                    <tr key={`${entry.source}-${entry.city}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono font-bold text-slate-800">{entry.source}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{entry.city}</td>
                      <td className={`px-3 py-2 font-bold ${collectorStatusTone(entry.status)}`}>
                        {collectorStatusLabel(entry.status)}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600">{formatTimestamp(entry.last_success_at)}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{entry.failure_count ?? 0}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{formatLatency(entry.last_latency_ms)}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{formatSeconds(entry.due_in_sec)}</td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-slate-500" title={entry.last_error || ""}>
                        {entry.last_error || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              当前后台采集器没有失败、冷却或到期积压。
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RadioTower className="h-4 w-4 text-blue-500" />
            城市数据源健康
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {["fresh", "expected_wait", "delayed", "stale", "missing"].map((key) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">{sourceStatusLabel(key)}</div>
                <div className={`text-lg font-black ${sourceStatusTone(key)}`}>
                  {sourceHealth?.status_counts?.[key] ?? 0}
                </div>
              </div>
            ))}
          </div>

          {sourceIssues.length ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2">城市</th>
                    <th className="px-3 py-2">来源</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">延迟</th>
                    <th className="px-3 py-2">最近观测</th>
                    <th className="px-3 py-2">原因</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceIssues.map(({ city, source }, index) => (
                    <tr key={`${city}-${source.role}-${source.source_code}-${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono font-bold text-slate-800">{city}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-800">{source.source_label || source.source_code}</div>
                        <div className="text-[11px] text-slate-500">{source.role}</div>
                      </td>
                      <td className={`px-3 py-2 font-bold ${sourceStatusTone(source.status)}`}>
                        {sourceStatusLabel(source.status)}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600">{formatAge(source.age_min)}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{source.observed_at || "—"}</td>
                      <td className="px-3 py-2 text-slate-500" title={source.reason || ""}>
                        {sourceReasonLabel(source.reason)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              当前缓存内未发现 MGM、KNMI、IMS 或机场站断线/延迟异常。
            </div>
          )}

          {(sourceHealth?.cities || []).some((city) => !city.cache_exists) ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              有城市缺少 full/panel 缓存，可能是后台冷启动或该城市尚未预热。
            </div>
          ) : null}
        </CardContent>
      </Card>

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
