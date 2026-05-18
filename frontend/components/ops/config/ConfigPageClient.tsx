"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type EditableConfig = {
  key: string;
  value: string;
  description: string;
};

export function ConfigPageClient() {
  const [configs, setConfigs] = useState<EditableConfig[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState("");

  const load = async () => {
    try {
      const res = await fetch("/api/ops/config");
      if (res.ok) {
        const data = (await res.json()) as { configs?: EditableConfig[] };
        setConfigs(data.configs ?? []);
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
            仅显示非敏感配置项。API Key 等密钥不在此处暴露。修改后立即生效，建议重启服务以确保持久化。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
