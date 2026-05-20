"use client";

import { useEffect, useState } from "react";
import { opsApi } from "@/lib/ops-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCcw,
  ShieldAlert,
  Copy,
  Check,
  Search,
  UserX,
  Mail,
  Calendar,
  AlertTriangle,
} from "lucide-react";

interface TelegramAnomaly {
  telegram_id: number;
  username: string;
  chat_id: string;
  status: string;
  anomaly_type: "unbound" | "expired" | "trial_only";
  reason: string;
  email: string | null;
  expires_at: string | null;
}

export function TelegramAuditPageClient() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    anomalies: TelegramAnomaly[];
    valid_count: number;
    anomaly_count: number;
    error?: string;
  } | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await opsApi.telegramAudit();
      setData(res);
    } catch (err: any) {
      setData({
        anomalies: [],
        valid_count: 0,
        anomaly_count: 0,
        error: err.message || "获取审核数据失败",
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCopy = (id: number) => {
    void navigator.clipboard.writeText(String(id));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (loading) {
    return (
      <div className="flex h-[400px] flex-col items-center justify-center gap-2">
        <RefreshCcw className="h-8 w-8 animate-spin text-cyan-400" />
        <p className="text-sm text-slate-400">正在与电报服务器同步并审计群成员，可能需要几秒钟...</p>
      </div>
    );
  }

  const anomalies = data?.anomalies ?? [];
  const error = data?.error;

  const filtered = anomalies.filter((item) => {
    const matchesFilter = filterType === "all" || item.anomaly_type === filterType;
    const matchesSearch =
      searchQuery.trim() === "" ||
      String(item.telegram_id).includes(searchQuery) ||
      (item.username && item.username.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.email && item.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.reason && item.reason.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const countUnbound = anomalies.filter((x) => x.anomaly_type === "unbound").length;
  const countExpired = anomalies.filter((x) => x.anomaly_type === "expired").length;
  const countTrial = anomalies.filter((x) => x.anomaly_type === "trial_only").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">电报群清理与异常检测</h1>
          <p className="text-sm text-slate-400 mt-1">
            本页通过核对本地数据库中与 Bot 交互过（或绑定过）的用户，实时查询 Telegram 接口审计群成员资格。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} className="gap-1.5 bg-slate-900 border-white/10 hover:bg-slate-800 text-slate-200">
          <RefreshCcw className="h-3.5 w-3.5" /> 重新检测
        </Button>
      </div>

      {error && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-red-200">检测出发生错误</h4>
              <p className="text-sm text-red-300/80 mt-1">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-slate-900/60 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-400 uppercase">群内付费用户 (正常)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">{data?.valid_count ?? 0} 人</div>
            <p className="text-[11px] text-slate-500 mt-1">已绑定且在订阅期内的正常付费用户</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-400 uppercase">未绑定网页账号</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-400">{countUnbound} 人</div>
            <p className="text-[11px] text-slate-500 mt-1">未能在网页端找到绑定对应 TG 的记录</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-400 uppercase">订阅已过期</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{countExpired} 人</div>
            <p className="text-[11px] text-slate-500 mt-1">已绑定，但当前没有任何有效订阅</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-400 uppercase">仅拥有试用期</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-400">{countTrial} 人</div>
            <p className="text-[11px] text-slate-500 mt-1">仅注册了免费试用订阅（不具备入群资格）</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="bg-slate-900/60 border-white/5">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={filterType === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterType("all")}
                className="text-xs rounded-lg"
              >
                全部异常 ({anomalies.length})
              </Button>
              <Button
                variant={filterType === "unbound" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterType("unbound")}
                className="text-xs rounded-lg"
              >
                未绑定 ({countUnbound})
              </Button>
              <Button
                variant={filterType === "expired" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterType("expired")}
                className={`text-xs rounded-lg ${filterType === "expired" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
              >
                已过期 ({countExpired})
              </Button>
              <Button
                variant={filterType === "trial_only" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterType("trial_only")}
                className={`text-xs rounded-lg ${filterType === "trial_only" ? "bg-yellow-500 hover:bg-yellow-600 text-slate-900" : ""}`}
              >
                试用中 ({countTrial})
              </Button>
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="搜索用户名/电报ID/邮箱..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 bg-slate-950 border-white/10 text-xs rounded-lg text-slate-100 placeholder:text-slate-500"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Table */}
      <Card className="bg-slate-900/60 border-white/5">
        <CardHeader className="pb-3 border-b border-white/5">
          <CardTitle className="text-sm font-semibold text-slate-300">需清理成员列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-300">
              <thead className="text-xs uppercase bg-slate-950/40 text-slate-400">
                <tr>
                  <th scope="col" className="px-6 py-3.5">电报用户名 & ID</th>
                  <th scope="col" className="px-6 py-3.5 text-center">异常类型</th>
                  <th scope="col" className="px-6 py-3.5">原因</th>
                  <th scope="col" className="px-6 py-3.5">绑定邮箱</th>
                  <th scope="col" className="px-6 py-3.5">订阅到期日</th>
                  <th scope="col" className="px-6 py-3.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.length > 0 ? (
                  filtered.map((row) => (
                    <tr key={`${row.telegram_id}-${row.chat_id}`} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-white flex items-center gap-1.5">
                          {row.username.startsWith("@") ? (
                            <a
                              href={`https://t.me/${row.username.substring(1)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:underline"
                            >
                              {row.username}
                            </a>
                          ) : (
                            <span>{row.username}</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5 flex items-center gap-1.5">
                          <span>{row.telegram_id}</span>
                          <button
                            onClick={() => handleCopy(row.telegram_id)}
                            className="text-slate-600 hover:text-slate-400 p-0.5 rounded transition-colors"
                            title="复制电报 ID"
                          >
                            {copiedId === row.telegram_id ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {row.anomaly_type === "unbound" ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                            未绑定
                          </span>
                        ) : row.anomaly_type === "expired" ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                            已到期
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                            试用会员
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-300 text-xs">
                        {row.reason}
                      </td>
                      <td className="px-6 py-4">
                        {row.email ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            <span className="truncate max-w-[160px]" title={row.email}>
                              {row.email}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {row.expires_at ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Calendar className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            <span>{row.expires_at.split("T")[0]}</span>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(row.telegram_id)}
                          className="h-7 px-2 text-[11px] gap-1 bg-slate-950/40 hover:bg-slate-800 border border-white/5 text-slate-300 hover:text-white rounded-lg transition-colors"
                        >
                          <UserX className="h-3.5 w-3.5 text-red-400/80" />
                          复制 ID
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500 text-xs">
                      {searchQuery ? "未找到符合搜索条件的异常成员" : "当前群内没有检测出任何已过期的异常成员 🎉"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-cyan-500/10 bg-cyan-950/10">
        <CardContent className="pt-6 text-xs text-slate-400 leading-relaxed">
          <p className="font-semibold text-cyan-300 mb-1">💡 怎么手动清理？</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>在上述列表中点击任意用户的 <code className="bg-slate-950/60 px-1 py-0.5 rounded text-cyan-400">复制 ID</code> 按钮。</li>
            <li>打开你的 Telegram 客户端，进入对应的群组设置面板。</li>
            <li>点击群成员列表中的“添加成员”或直接搜索该用户的电报 ID 或电报用户名。</li>
            <li>在用户资料卡中选择 <code className="text-red-400">Remove from Group (踢出群组)</code> 即可。</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
