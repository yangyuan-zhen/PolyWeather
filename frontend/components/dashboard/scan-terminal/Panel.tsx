"use client";

import clsx from "clsx";

export function Panel({
  children,
  className,
  title,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={clsx(
        "flex flex-col overflow-hidden rounded-[4px] border border-[#d2d9e2] bg-white h-full min-h-0",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#e5e7eb] bg-[#f8f9fa] px-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#202833] flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
          {title}
        </h2>
        <div className="flex items-center gap-1.5">
          {actions}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </section>
  );
}
