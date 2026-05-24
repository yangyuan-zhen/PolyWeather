"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function DashboardShellSkeleton() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#e9edf3] font-sans text-slate-900">
      {/* Dark Sidebar */}
      <aside className="w-[52px] shrink-0 bg-[#171d24] flex flex-col items-center gap-4 py-4">
        {/* Logo Placeholder */}
        <div className="w-8 h-8 rounded bg-blue-600/30 animate-pulse" />
        {/* Menu Icon */}
        <div className="w-6 h-6 rounded bg-slate-700/50" />
        {/* Navigation Items */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-8 h-8 rounded bg-slate-700/20" />
        ))}
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Dark Top Header */}
        <header className="h-[64px] shrink-0 bg-[#171d24] flex items-center justify-between px-4">
          <div className="flex items-center gap-4 w-1/3">
            {/* Search Box Skeleton */}
            <div className="h-10 w-full max-w-[320px] rounded bg-slate-700/40" />
            {/* Title Skeleton */}
            <div className="h-4 w-32 rounded bg-slate-700/30 hidden md:block" />
          </div>
          <div className="flex items-center gap-3">
            {/* Clock & Profile Skeletons */}
            <div className="h-4 w-16 rounded bg-slate-700/30 font-mono" />
            <div className="h-9 w-20 rounded bg-slate-700/40" />
            <div className="h-9 w-9 rounded-full bg-slate-700/40" />
          </div>
        </header>

        {/* Workspace Body Skeletons (3 Columns) */}
        <main className="flex-1 overflow-hidden p-2 grid grid-cols-1 gap-2 xl:grid-cols-[1.12fr_1.6fr_1.1fr]">
          {/* Column 1 */}
          <div className="flex flex-col gap-2 min-h-0">
            {/* Card 1 */}
            <div className="flex-1 rounded border border-[#cfd6df] bg-white p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <Skeleton className="h-4 w-28 bg-slate-200" />
                <div className="w-4 h-4 rounded bg-slate-100" />
              </div>
              <Skeleton className="h-12 w-full bg-slate-100/80 rounded animate-pulse" />
              <div className="flex-1 flex flex-col gap-2 mt-2">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <Skeleton className="h-4 w-32 bg-slate-100" />
                    <Skeleton className="h-4 w-12 bg-slate-100" />
                  </div>
                ))}
              </div>
            </div>
            {/* Card 2 */}
            <div className="h-1/3 rounded border border-[#cfd6df] bg-white p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <Skeleton className="h-4 w-32 bg-slate-200" />
                <div className="w-4 h-4 rounded bg-slate-100" />
              </div>
              <div className="flex-1 flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-8 w-full bg-slate-100" />
                ))}
              </div>
            </div>
          </div>

          {/* Column 2 */}
          <div className="flex flex-col gap-2 min-h-0">
            {/* Card 1 */}
            <div className="h-[200px] rounded border border-[#cfd6df] bg-white p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <Skeleton className="h-4 w-40 bg-slate-200" />
                <div className="w-4 h-4 rounded bg-slate-100" />
              </div>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-32 bg-slate-200" />
                  <Skeleton className="h-3 w-full bg-slate-100" />
                  <Skeleton className="h-3 w-2/3 bg-slate-100" />
                </div>
                <Skeleton className="w-32 h-16 bg-slate-100 rounded" />
              </div>
            </div>
            {/* Card 2 */}
            <div className="h-[120px] rounded border border-[#cfd6df] bg-white p-4 flex flex-col justify-between">
              <Skeleton className="h-4 w-32 bg-slate-200" />
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-10 w-full bg-slate-100" />
                <Skeleton className="h-10 w-full bg-slate-100" />
                <Skeleton className="h-10 w-full bg-slate-100" />
              </div>
            </div>
            {/* Card 3 */}
            <div className="flex-1 rounded border border-[#cfd6df] bg-white p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <Skeleton className="h-4 w-28 bg-slate-200" />
                <div className="w-4 h-4 rounded bg-slate-100" />
              </div>
              <div className="flex-1 flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-10 w-full bg-slate-100" />
                ))}
              </div>
            </div>
          </div>

          {/* Column 3 */}
          <div className="flex flex-col gap-2 min-h-0">
            {/* Card 1 */}
            <div className="flex-1 rounded border border-[#cfd6df] bg-white p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <Skeleton className="h-4 w-24 bg-slate-200" />
                <div className="w-4 h-4 rounded bg-slate-100" />
              </div>
              <div className="flex-1 flex flex-col gap-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-10 w-full bg-slate-100" />
                ))}
              </div>
            </div>
            {/* Card 2 */}
            <div className="h-1/3 rounded border border-[#cfd6df] bg-white p-4 flex flex-col justify-between">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <Skeleton className="h-4 w-36 bg-slate-200" />
                <div className="w-4 h-4 rounded bg-slate-100" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="h-12 bg-slate-100 rounded flex flex-col justify-center items-center gap-1">
                  <Skeleton className="h-3 w-6 bg-slate-200" />
                  <Skeleton className="h-2 w-8 bg-slate-200/50" />
                </div>
                <div className="h-12 bg-slate-100 rounded flex flex-col justify-center items-center gap-1">
                  <Skeleton className="h-3 w-6 bg-slate-200" />
                  <Skeleton className="h-2 w-8 bg-slate-200/50" />
                </div>
                <div className="h-12 bg-slate-100 rounded flex flex-col justify-center items-center gap-1">
                  <Skeleton className="h-3 w-6 bg-slate-200" />
                  <Skeleton className="h-2 w-8 bg-slate-200/50" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
