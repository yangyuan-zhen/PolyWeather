"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function DashboardShellSkeleton() {
  return (
    <div
      style={{
        background:
          "radial-gradient(circle at top, rgba(30,41,59,0.45), rgba(2,6,23,0.98) 55%)",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
        width: "100vw",
      }}
    >
      <div
        style={{
          alignItems: "center",
          backdropFilter: "blur(16px)",
          background: "rgba(10,14,26,0.78)",
          borderBottom: "1px solid rgba(99,102,241,0.15)",
          display: "flex",
          height: 56,
          justifyContent: "space-between",
          left: 0,
          padding: "0 24px",
          position: "fixed",
          right: 0,
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton className="h-6 w-40 bg-zinc-700/60" />
          <Skeleton className="h-3 w-28 bg-zinc-800/70" />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Skeleton className="h-8 w-20 rounded-full bg-zinc-800/70" />
          <Skeleton className="h-8 w-28 rounded-full bg-zinc-800/70" />
        </div>
      </div>

      <div
        style={{
          bottom: 24,
          display: "flex",
          gap: 24,
          left: 24,
          position: "absolute",
          right: 24,
          top: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxWidth: 280,
            width: "22vw",
          }}
        >
          <Skeleton className="h-10 w-40 rounded-xl bg-zinc-800/80" />
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton
              key={index}
              className="h-14 w-full rounded-2xl bg-zinc-900/75"
            />
          ))}
        </div>

        <div style={{ flex: 1, position: "relative" }}>
          <Skeleton className="h-full w-full rounded-[28px] bg-zinc-950/55" />
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton
              key={index}
              className="absolute rounded-full bg-cyan-500/20"
              style={{
                height: 18,
                left: `${10 + index * 10}%`,
                top: `${20 + ((index * 9) % 45)}%`,
                width: 18,
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxWidth: 420,
            width: "30vw",
          }}
        >
          <Skeleton className="h-16 w-full rounded-3xl bg-zinc-900/80" />
          <Skeleton className="h-48 w-full rounded-3xl bg-zinc-900/70" />
          <Skeleton className="h-32 w-full rounded-3xl bg-zinc-900/70" />
        </div>
      </div>
    </div>
  );
}
