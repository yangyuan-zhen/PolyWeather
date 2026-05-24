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
      className={clsx("scan-loading-signal", compact && "compact")}
      role="status"
      aria-live="polite"
    >
      <div className="scan-loading-spinner-wrapper" aria-hidden="true">
        <div className="scan-loading-spinner-ring" />
        <img
          src="/static/logo.png"
          alt="PolyWeather"
          className="scan-loading-spinner-logo"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/logo.png";
          }}
        />
      </div>
      <div className="scan-loading-copy-block">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
    </div>
  );
}
