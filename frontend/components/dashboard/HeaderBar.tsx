"use client";

import clsx from "clsx";
import { useDashboardStore } from "@/hooks/useDashboardStore";

export function HeaderBar() {
  const store = useDashboardStore();

  return (
    <header className="header">
      <div className="brand">
        <h1>PolyWeather</h1>
        <span className="subtitle">天气衍生品智能分析</span>
      </div>
      <button
        type="button"
        className="info-btn"
        title="查看系统技术说明"
        aria-label="查看系统技术说明"
        onClick={store.openGuide}
      >
        技术说明
      </button>
      <div className="live-badge" id="liveBadge">
        <span className="pulse-dot" />
        <span>实时</span>
      </div>
      <button
        type="button"
        className={clsx("refresh-btn", store.loadingState.refresh && "spinning")}
        title="刷新所有数据"
        aria-label="刷新所有数据"
        onClick={() => void store.refreshAll()}
      >
        ↻
      </button>
    </header>
  );
}
