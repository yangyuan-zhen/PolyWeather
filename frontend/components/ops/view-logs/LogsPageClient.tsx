"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw, Pause, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function LogsPageClient() {
  const [lines, setLines] = useState<string[]>([]);
  const [level, setLevel] = useState("");
  const [limit, setLimit] = useState(100);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ lines: String(limit) });
      if (level) params.set("level", level);
      const res = await fetch(`/api/ops/view-logs?${params}`);
      if (res.ok) {
        const data = (await res.json()) as { lines?: string[] };
        setLines(data.lines ?? []);
        setError("");
      } else {
        setError(await res.text().catch(() => "fetch failed"));
      }
    } catch {
      setError("日志 API 尚未就绪（需要后端支持）");
    }
  }, [level, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(load, 5000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, load]);

  const levelColor = (line: string) => {
    if (line.includes("ERROR")) return "text-red-400";
    if (line.includes("WARNING")) return "text-amber-400";
    if (line.includes("INFO")) return "text-slate-300";
    return "text-slate-500";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">日志查看</h1>
        <div className="flex gap-2 flex-wrap">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
          >
            <option value="">全部级别</option>
            <option value="info">INFO</option>
            <option value="warning">WARNING</option>
            <option value="error">ERROR</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
          >
            <option value="50">50 行</option>
            <option value="100">100 行</option>
            <option value="200">200 行</option>
            <option value="500">500 行</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="gap-1.5"
          >
            {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {autoRefresh ? "暂停" : "自动刷新"}
          </Button>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCcw className="h-3.5 w-3.5" /> 刷新
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-amber-400 text-sm">{error}</div>
          ) : (
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto font-mono text-xs leading-relaxed">
              <div className="min-w-[800px]">
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className={`px-4 py-0.5 border-b border-white/[0.02] hover:bg-white/[0.03] ${levelColor(line)}`}
                  >
                    {line}
                  </div>
                ))}
                {lines.length === 0 && (
                  <div className="p-6 text-center text-slate-500">暂无日志</div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
