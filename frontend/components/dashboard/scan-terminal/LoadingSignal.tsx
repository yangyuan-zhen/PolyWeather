import clsx from "clsx";

export function LoadingSignal({
  title,
  description,
  compact = false,
}: {
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center text-center select-none",
        compact ? "p-4 gap-2 w-full max-w-[280px]" : "p-6 gap-4 w-full max-w-[360px]"
      )}
      role="status"
      aria-live="polite"
    >
      <div 
        className={clsx(
          "relative flex items-center justify-center rounded-full shrink-0",
          compact ? "w-16 h-16" : "w-24 h-24"
        )} 
        aria-hidden="true"
      >
        {/* Background Track Ring */}
        <div className="absolute inset-0 rounded-full border-[3px] border-slate-200/80 dark:border-slate-800" />
        
        {/* Active Spinning Ring */}
        <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-blue-500 border-r-blue-400 animate-spin" />
        
        {/* Centered Rounded Logo Card */}
        <div 
          className={clsx(
            "absolute bg-white dark:bg-slate-900 rounded-xl flex items-center justify-center shadow-sm border border-slate-100/80 dark:border-slate-800/80",
            compact ? "w-10 h-10" : "w-14 h-14"
          )}
        >
          <img
            src="/apple-touch-icon.png"
            alt="PolyWeather Logo"
            className={clsx(
              "object-contain rounded-lg",
              compact ? "w-7 h-7" : "w-10 h-10"
            )}
          />
        </div>
      </div>
      
      {/* Text Copy */}
      <div className="flex flex-col items-center gap-1">
        <strong className={clsx(
          "font-bold text-slate-800 dark:text-slate-100",
          compact ? "text-xs" : "text-sm"
        )}>
          {title}
        </strong>
        {description && (
          <span className={clsx(
            "text-slate-500 dark:text-slate-400 leading-normal",
            compact ? "text-[10px] max-w-[200px]" : "text-xs max-w-[280px]"
          )}>
            {description}
          </span>
        )}
      </div>
    </div>
  );
}
