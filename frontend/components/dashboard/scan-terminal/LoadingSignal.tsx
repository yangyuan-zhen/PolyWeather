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
      <div className="scan-loading-decision-flow" aria-hidden="true">
        <span className="scan-loading-node hot" />
        <span className="scan-loading-rail">
          <i />
        </span>
        <span className="scan-loading-node market" />
        <span className="scan-loading-rail">
          <i />
        </span>
        <span className="scan-loading-node action" />
      </div>
      <div className="scan-loading-copy-block">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="scan-loading-signal-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
