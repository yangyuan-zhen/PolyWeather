"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Cpu,
  Database,
  CreditCard,
  Users,
  UserCheck,
  BarChart3,
  Settings,
  FileText,
  ScrollText,
  Activity,
} from "lucide-react";

const navGroups = [
  {
    label: "监控",
    items: [
      { href: "/ops/system", icon: Cpu, label: "系统状态" },
      { href: "/ops/training", icon: Database, label: "训练数据" },
      { href: "/ops/analytics", icon: BarChart3, label: "转化分析" },
    ],
  },
  {
    label: "运营",
    items: [
      { href: "/ops/payments", icon: CreditCard, label: "支付管理" },
      { href: "/ops/memberships", icon: UserCheck, label: "会员订阅" },
      { href: "/ops/users", icon: Users, label: "用户积分" },
    ],
  },
  {
    label: "管理",
    items: [
      { href: "/ops/config", icon: Settings, label: "系统配置" },
      { href: "/ops/subscriptions", icon: ScrollText, label: "订阅操作" },
      { href: "/ops/logs", icon: FileText, label: "日志查看" },
    ],
  },
  {
    label: "历史",
    items: [
      { href: "/ops/truth-history", icon: Activity, label: "真值历史" },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r border-white/10 bg-slate-950 flex flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <LayoutDashboard className="h-5 w-5 text-cyan-400" />
        <Link href="/ops/system" className="text-sm font-bold text-white">
          PolyWeather Ops
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 space-y-6">
        {navGroups.map((group) => (
          <div key={group.label} className="px-3">
            <h4 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {group.label}
            </h4>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={
                        "flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors " +
                        (isActive
                          ? "bg-white/10 text-white font-medium"
                          : "text-slate-400 hover:bg-white/5 hover:text-slate-200")
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          ← 返回前台
        </Link>
      </div>
    </aside>
  );
}
