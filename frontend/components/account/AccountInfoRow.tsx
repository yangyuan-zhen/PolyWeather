import type { LucideIcon } from "lucide-react";

type InfoRowProps = {
  icon?: LucideIcon;
  label: string;
  value: string;
  isPrimary?: boolean;
};

export const InfoRow = ({
  icon: Icon,
  label,
  value,
  isPrimary = false,
}: InfoRowProps) => (
  <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-slate-300 hover:bg-slate-50 group sm:flex-row sm:items-center sm:justify-between">
    <div className="flex min-w-0 items-center gap-3">
      <div className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-500 transition-colors group-hover:text-blue-600">
        {Icon && <Icon size={18} />}
      </div>
      <span className="min-w-0 text-sm font-medium leading-5 text-slate-500">
        {label}
      </span>
    </div>
    <span
      className={`min-w-0 break-all text-left font-mono text-sm font-semibold sm:text-right ${isPrimary ? "text-blue-700" : "text-slate-900"}`}
    >
      {value}
    </span>
  </div>
);


export function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  );
}
