"use client";

import { useCallback, useState } from "react";
import { Search, Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { OpsUser } from "@/types/ops";

export function UsersPageClient() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [users, setUsers] = useState<OpsUser[]>([]);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantPoints, setGrantPoints] = useState(100);
  const [grantResult, setGrantResult] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await opsApi.users(query.trim());
      setUsers((data as unknown as { users?: OpsUser[] }).users ?? []);
    } catch { /* */ }
    setSearching(false);
  }, [query]);

  const handleGrant = async () => {
    if (!grantEmail.trim() || grantPoints <= 0) return;
    setGrantBusy(true);
    setGrantResult("");
    try {
      const data = await opsApi.grantPoints(grantEmail.trim(), grantPoints);
      const result = data as unknown as { ok?: boolean; points_added?: number; points_after?: number; reason?: string };
      if (result.ok) {
        setGrantResult(`成功: +${result.points_added} 分, 当前 ${result.points_after} 分`);
      } else {
        setGrantResult(`失败: ${result.reason ?? "unknown"}`);
      }
    } catch (e) {
      setGrantResult(`错误: ${String(e).slice(0, 100)}`);
    }
    setGrantBusy(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">用户积分</h1>

      {/* Search */}
      <Card>
        <CardHeader><CardTitle>用户搜索</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="用户名 / 邮箱"
              className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-400/50"
            />
            <Button onClick={search} disabled={searching || !query.trim()} size="sm" className="gap-1.5">
              <Search className="h-3.5 w-3.5" /> 搜索
            </Button>
          </div>
          {users.length > 0 && (
            <div className="mt-4 space-y-2">
              {users.map((u, i) => (
                <div key={u.supabase_email || i} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-4 py-3">
                  <div>
                    <span className="text-white font-medium">{u.username || u.supabase_email || "--"}</span>
                    <span className="text-slate-500 text-xs ml-2">{u.supabase_email || ""}</span>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-cyan-400">{u.points ?? 0} 积分</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grant Points */}
      <Card>
        <CardHeader><CardTitle>积分运营</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <input
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              placeholder="用户 Supabase 邮箱"
              className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-400/50"
            />
            <input
              type="number"
              value={grantPoints}
              onChange={(e) => setGrantPoints(Math.max(1, Math.min(100000, Number(e.target.value) || 0)))}
              className="w-24 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
            />
            <Button onClick={handleGrant} disabled={grantBusy} size="sm" className="gap-1.5">
              <Coins className="h-3.5 w-3.5" /> 补分
            </Button>
          </div>
          {grantResult && (
            <p className={`mt-3 text-sm ${grantResult.startsWith("成功") ? "text-emerald-400" : "text-amber-400"}`}>
              {grantResult}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
