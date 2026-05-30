"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";

type GrowthRow = { date: string; trial: number; paid: number; total: number; cumulative: number };
type StepRow = { key?: string; label: string; count: number; pct_of_prev?: number; uniqueActors?: number };
type BucketRow = { name: string; value: number };
type PieRow = { name: string; value: number; color?: string };
type CacheAnalysis = {
  total_requests?: number;
  cache_hits?: number;
  cache_misses?: number;
  force_refresh_requests?: number;
  hit_rate?: number | null;
};

export function OverviewCharts({
  growth,
  steps,
  cacheBuckets,
  memberPie,
  planBreakdown,
  cachePie,
  cacheAnalysis,
}: {
  growth: GrowthRow[];
  steps: StepRow[];
  cacheBuckets: BucketRow[];
  memberPie: PieRow[];
  planBreakdown: PieRow[];
  cachePie: PieRow[];
  cacheAnalysis?: CacheAnalysis;
}) {
  return (
    <div className="space-y-5">
      {growth.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">会员增长趋势 — 近 30 天</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs text-slate-500 mb-2">累计会员</h4>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={growth}>
                    <defs>
                      <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={35} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="cumulative" stroke="#06b6d4" fillOpacity={1} fill="url(#colorCumulative)" name="累计" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div>
                <h4 className="text-xs text-slate-500 mb-2">每日新增</h4>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={growth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={25} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="paid" stackId="1" stroke="#22c55e" fill="#22c55e40" name="付费" />
                    <Area type="monotone" dataKey="trial" stackId="1" stroke="#f59e0b" fill="#f59e0b40" name="体验" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          {steps.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">30天转化漏斗</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={[...steps].reverse().map((s) => ({ name: s.label, count: s.count }))} layout="vertical" margin={{ left: 80, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={75} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#06b6d4" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {cacheBuckets.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">缓存桶分布</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={cacheBuckets} layout="vertical" margin={{ left: 50, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={45} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#6366f1" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">会员分布</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-36 h-36 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={memberPie} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={2} dataKey="value">
                        {memberPie.map((item, i) => (<Cell key={i} fill={item.color || "#64748b"} />))}
                      </Pie>
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5 text-sm">
                  {memberPie.map((item) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-slate-400">{item.name}</span>
                      <span className="text-white font-bold ml-auto">{item.value}</span>
                    </div>
                  ))}
                  {planBreakdown.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-white/10 space-y-1">
                      {planBreakdown.map((item) => (
                        <div key={item.name} className="flex justify-between text-xs">
                          <span className="text-slate-500">{item.name}</span>
                          <span className="text-slate-300">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {cachePie.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  缓存分析{" "}
                  {cacheAnalysis?.hit_rate != null && (
                    <span className="text-emerald-400 font-normal">{(cacheAnalysis.hit_rate * 100).toFixed(1)}% 命中</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="w-36 h-36 shrink-0">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={cachePie} cx="50%" cy="50%" innerRadius={36} outerRadius={58} paddingAngle={2} dataKey="value">
                          {cachePie.map((item, i) => (<Cell key={i} fill={item.color || "#64748b"} />))}
                        </Pie>
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-slate-500 text-xs">总请求</div>
                      <div className="text-white font-bold">{cacheAnalysis?.total_requests ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-xs">强制刷新</div>
                      <div className="text-blue-400 font-bold">{cacheAnalysis?.force_refresh_requests ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-xs">命中</div>
                      <div className="text-emerald-400 font-bold">{cacheAnalysis?.cache_hits ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-xs">未命中</div>
                      <div className="text-amber-400 font-bold">{cacheAnalysis?.cache_misses ?? 0}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
