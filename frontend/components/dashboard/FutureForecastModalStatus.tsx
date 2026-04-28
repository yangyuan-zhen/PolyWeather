import clsx from "clsx";

export type FutureSyncStatusItem = {
  key: string;
  state: "ready" | "syncing";
  label: string;
  note: string;
};

export function FutureRefreshLock({ locale }: { locale: string }) {
  return (
    <div
      className="future-v2-refresh-lock"
      role="status"
      aria-live="assertive"
    >
      <span className="future-v2-refresh-spinner" aria-hidden="true" />
      <div>
        <strong>
          {locale === "en-US"
            ? "Refreshing latest intraday data"
            : "正在刷新最新日内数据"}
        </strong>
        <p>
          {locale === "en-US"
            ? "Old cached readings are temporarily locked to prevent misjudgement. The analysis will unlock after the latest anchor observation, model layer, and probability layer are ready."
            : "旧缓存读数已临时锁定，避免误判。最新锚点观测、模型层和概率层就绪后会自动解锁。"}
        </p>
      </div>
    </div>
  );
}

export function FutureSyncStatusStrip({
  items,
  compact = false,
}: {
  items: readonly FutureSyncStatusItem[];
  compact?: boolean;
}) {
  return (
    <section
      className={clsx("future-v2-sync-strip", compact && "future-v2-sync-strip-compact")}
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.key}
          className={clsx(
            "future-v2-sync-chip",
            item.state === "syncing" && "syncing",
          )}
        >
          <span className="future-v2-sync-dot" aria-hidden="true" />
          <div className="future-v2-sync-copy">
            <strong>{item.label}</strong>
            <span>{item.note}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
