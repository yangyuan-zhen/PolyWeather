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
      <div className="min-h-screen bg-[#f4f7fb] text-slate-700">
        <div className="mx-auto w-full max-w-6xl px-6 py-10">
          <div className="h-7 w-48 animate-pulse rounded bg-slate-200" />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white md:col-span-2" />
            <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          </div>
          <div className="mt-6 h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      </div>
    ),
  },
);

export function AccountEntry() {
  return <AccountCenter />;
}
