"use client";

import dynamic from "next/dynamic";

const AccountCenter = dynamic(
  () =>
    import("@/components/account/AccountCenter").then(
      (module) => module.AccountCenter,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-slate-950 text-slate-300">
        <div className="mx-auto w-full max-w-6xl px-6 py-10">
          <div className="h-7 w-48 animate-pulse rounded bg-slate-800/80" />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="h-32 animate-pulse rounded-3xl bg-slate-800/70 md:col-span-2" />
            <div className="h-32 animate-pulse rounded-3xl bg-slate-800/70" />
          </div>
          <div className="mt-6 h-72 animate-pulse rounded-3xl bg-slate-800/60" />
        </div>
      </div>
    ),
  },
);

export function AccountEntry() {
  return <AccountCenter />;
}
