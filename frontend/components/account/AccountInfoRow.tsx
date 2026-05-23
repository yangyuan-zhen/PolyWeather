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
  <div className="flex min-w-0 flex-col gap-3 p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all group sm:flex-row sm:items-center sm:justify-between">
    <div className="flex min-w-0 items-center gap-3">
      <div className="shrink-0 p-2 bg-slate-800 rounded-lg text-slate-400 group-hover:text-blue-400 transition-colors">
        {Icon && <Icon size={18} />}
      </div>
      <span className="min-w-0 text-slate-400 text-sm font-medium leading-5">
        {label}
      </span>
    </div>
    <span
      className={`min-w-0 break-all text-left text-sm font-semibold font-mono sm:text-right ${isPrimary ? "text-blue-400" : "text-slate-200"}`}
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
