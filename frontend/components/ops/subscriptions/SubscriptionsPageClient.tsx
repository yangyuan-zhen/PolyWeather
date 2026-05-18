"use client";

import { useState } from "react";
import { ScrollText, Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function SubscriptionsPageClient() {
  const [email, setEmail] = useState("");
  const [planCode, setPlanCode] = useState("pro_monthly");
  const [days, setDays] = useState(30);
  const [extendDays, setExtendDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const handleGrant = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setResult("");
    try {
      const res = await fetch("/api/ops/subscriptions/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), plan_code: planCode, days }),
      });
      if (res.ok) {
        setResult(`已为 ${email} 开通 ${planCode}，${days} 天`);
      } else {
        setResult(`失败: ${await res.text().catch(() => "")}`);
      }
    } catch (e) {
      setResult(`错误: ${String(e).slice(0, 100)}`);
    }
    setBusy(false);
  };

  const handleExtend = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setResult("");
    try {
      const res = await fetch("/api/ops/subscriptions/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), additional_days: extendDays }),
      });
      if (res.ok) {
        setResult(`已为 ${email} 延期 ${extendDays} 天`);
      } else {
        setResult(`失败: ${await res.text().catch(() => "")}`);
      }
    } catch (e) {
      setResult(`错误: ${String(e).slice(0, 100)}`);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">订阅操作</h1>
      <p className="text-sm text-slate-500">手动为用户开通或延期订阅（需要后端 API 就绪）</p>

      <Card>
        <CardHeader><CardTitle>手动开通</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="用户 Supabase 邮箱"
              className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-400/50"
            />
            <select
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
            >
              <option value="pro_monthly">Pro 月付</option>
              <option value="pro_quarterly">Pro 季付</option>
              <option value="pro_yearly">Pro 年付</option>
            </select>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
              className="w-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
            />
            <Button onClick={handleGrant} disabled={busy} size="sm" className="gap-1.5">
              <Coins className="h-3.5 w-3.5" /> 开通
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>手动延期</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="用户 Supabase 邮箱"
              className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-400/50"
            />
            <input
              type="number"
              value={extendDays}
              onChange={(e) => setExtendDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
              className="w-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
            />
            <span className="text-slate-400 text-sm self-center">天</span>
            <Button onClick={handleExtend} disabled={busy} size="sm" className="gap-1.5">
              <ScrollText className="h-3.5 w-3.5" /> 延期
            </Button>
          </div>
          {result && (
            <p className={`mt-3 text-sm ${result.startsWith("失败") || result.startsWith("错误") ? "text-amber-400" : "text-emerald-400"}`}>
              {result}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
