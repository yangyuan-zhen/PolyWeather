"use client";

import { useEffect, useState } from "react";
import { KeyRound, RefreshCcw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type EditableConfig = {
  key: string;
  value: string;
  description: string;
};

type SensitiveConfig = {
  key: string;
  label: string;
  description: string;
  configured: boolean;
  masked: string;
  length: number;
  updated_at: string;
  updated_by: string;
  source: string;
};

type SensitiveHealth = {
  ok?: boolean;
  status?: number;
  latency_ms?: number;
  points?: number;
  observation_time_local?: string;
  error?: string;
};

export function ConfigPageClient() {
  const [configs, setConfigs] = useState<EditableConfig[]>([]);
  const [sensitiveConfigs, setSensitiveConfigs] = useState<SensitiveConfig[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [sensitiveEditing, setSensitiveEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [sensitiveSaving, setSensitiveSaving] = useState(false);
  const [result, setResult] = useState("");
  const [sensitiveResult, setSensitiveResult] = useState("");
  const [sensitiveHealth, setSensitiveHealth] = useState<SensitiveHealth | null>(null);

  const load = async () => {
    try {
      const [res, sensitiveRes] = await Promise.all([
        fetch("/api/ops/config"),
        fetch("/api/ops/sensitive-config"),
      ]);
      if (res.ok) {
        const data = (await res.json()) as { configs?: EditableConfig[] };
        setConfigs(data.configs ?? []);
      }
      if (sensitiveRes.ok) {
        const data = (await sensitiveRes.json()) as { configs?: SensitiveConfig[] };
        setSensitiveConfigs(data.configs ?? []);
      }
    } catch { /* backend not ready yet */ }
  };

  const handleSave = async (key: string) => {
    const newVal = editing[key];
    if (newVal == null) return;
    setSaving(true);
    setResult("");
    try {
      const res = await fetch("/api/ops/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: newVal }),
      });
      if (res.ok) {
        setResult(`${key} 已更新`);
        setConfigs((prev) => prev.map((c) => (c.key === key ? { ...c, value: newVal } : c)));
        setEditing((prev) => { const n = { ...prev }; delete n[key]; return n; });
      } else {
        setResult(`保存失败: ${await res.text().catch(() => "")}`);
      }
    } catch {
      setResult("保存失败");
    }
    setSaving(false);
  };

  const handleSensitiveSave = async (key: string) => {
    const newVal = sensitiveEditing[key]?.trim();
    if (!newVal) return;
    setSensitiveSaving(true);
    setSensitiveResult("");
    setSensitiveHealth(null);
    try {
      const res = await fetch("/api/ops/sensitive-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: newVal }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          config?: SensitiveConfig;
          health?: SensitiveHealth | null;
        };
        if (data.config) {
          setSensitiveConfigs((prev) => prev.map((cfg) => (cfg.key === key ? data.config as SensitiveConfig : cfg)));
        }
        setSensitiveEditing((prev) => { const n = { ...prev }; delete n[key]; return n; });
        setSensitiveHealth(data.health ?? null);
        setSensitiveResult(`${key} 已轮换`);
      } else {
        setSensitiveResult(`轮换失败: ${await res.text().catch(() => "")}`);
      }
    } catch {
      setSensitiveResult("轮换失败");
    }
    setSensitiveSaving(false);
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">系统配置</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>可编辑配置</CardTitle>
        </CardHeader>
        <CardContent>
          {configs.length === 0 ? (
            <p className="text-slate-500 text-sm">配置 API 尚未就绪（需要后端支持）</p>
          ) : (
            <div className="space-y-3">
              {configs.map((cfg) => (
                <div key={cfg.key} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{cfg.key}</div>
                    <div className="text-slate-500 text-xs mt-0.5">{cfg.description}</div>
                  </div>
                  <input
                    value={editing[cfg.key] ?? cfg.value}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [cfg.key]: e.target.value }))}
                    className="w-24 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white font-mono text-center outline-none focus:border-cyan-400/50"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving || editing[cfg.key] === cfg.value || editing[cfg.key] == null}
                    onClick={() => handleSave(cfg.key)}
                    className="gap-1"
                  >
                    <Save className="h-3 w-3" /> 保存
                  </Button>
                </div>
              ))}
            </div>
          )}
          {result && (
            <p className={`mt-3 text-sm ${result.includes("失败") ? "text-amber-400" : "text-emerald-400"}`}>
              {result}
            </p>
          )}
          <p className="mt-4 text-xs text-slate-500">
            仅显示非敏感配置项。修改后立即影响当前后端进程；需要跨重启持久化的密钥请使用下方凭证轮换模块。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-cyan-300" />
            敏感凭证轮换
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sensitiveConfigs.length === 0 ? (
            <p className="text-slate-500 text-sm">敏感配置 API 尚未就绪。</p>
          ) : (
            <div className="space-y-3">
              {sensitiveConfigs.map((cfg) => (
                <div key={cfg.key} className="rounded-lg border border-white/5 bg-white/5 px-4 py-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-white text-sm font-semibold">{cfg.label}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${cfg.configured ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>
                          {cfg.configured ? "已配置" : "未配置"}
                        </span>
                        <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] text-slate-400">
                          {cfg.source === "environment" ? "环境变量兜底" : "DB 持久化"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{cfg.description}</div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
                        <div>
                          <span className="text-slate-500">当前值 </span>
                          <span className="font-mono text-slate-200">{cfg.masked || "未设置"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">更新人 </span>
                          <span className="font-mono text-slate-200">{cfg.updated_by || "-"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">更新时间 </span>
                          <span className="font-mono text-slate-200">{cfg.updated_at || "-"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-[520px]">
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder="输入新的 sessionId，不会回显"
                        value={sensitiveEditing[cfg.key] ?? ""}
                        onChange={(e) => setSensitiveEditing((prev) => ({ ...prev, [cfg.key]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white font-mono outline-none focus:border-cyan-400/50"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={sensitiveSaving || !sensitiveEditing[cfg.key]?.trim()}
                        onClick={() => handleSensitiveSave(cfg.key)}
                        className="gap-1"
                      >
                        <Save className="h-3 w-3" /> 轮换
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {sensitiveResult && (
            <p className={`mt-3 text-sm ${sensitiveResult.includes("失败") ? "text-amber-400" : "text-emerald-400"}`}>
              {sensitiveResult}
            </p>
          )}
          {sensitiveHealth && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${sensitiveHealth.ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-amber-400/20 bg-amber-400/10 text-amber-200"}`}>
              AMSC 健康检查：{sensitiveHealth.ok ? "通过" : "失败"}
              {typeof sensitiveHealth.points === "number" ? ` · 跑道点 ${sensitiveHealth.points}` : ""}
              {sensitiveHealth.observation_time_local ? ` · 观测 ${sensitiveHealth.observation_time_local}` : ""}
              {sensitiveHealth.error ? ` · ${sensitiveHealth.error}` : ""}
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500">
            这里不会返回或展示明文。轮换值写入共享运行时数据库，后端和 Bot 会优先读取该值，环境变量仅作为兜底。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
