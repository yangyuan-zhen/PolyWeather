"use client";

import { Megaphone, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type AnnouncementText = {
  title: string;
  body: string;
};

type StaticUpdateAnnouncement = {
  id: string;
  publishedAt: string;
  expiresAt: string;
  zh: AnnouncementText;
  en: AnnouncementText;
};

type UpdateAnnouncementButtonProps = {
  isEn: boolean;
};

const STATIC_UPDATE_ANNOUNCEMENTS: StaticUpdateAnnouncement[] = [
  {
    id: "live-observation-chart-2026-06",
    publishedAt: "2026-06-17T00:00:00+08:00",
    expiresAt: "2026-07-31T00:00:00+08:00",
    zh: {
      title: "更新公告：实时观测和图表稳定性升级",
      body:
        "实时观测链路已和模型缓存拆分：SSE 到达会立即更新图表；如果 SSE 断线，终端会每 3 分钟拉取一次轻量观测兜底。DEB、模型曲线、概率和历史数据继续走独立缓存，不再跟着实时温度强刷。\n\n" +
        "这次也补齐了更多官方观测覆盖，包括东京 JMA、韩国 AMOS、土耳其 MGM、台北 CWA 等，并修正 NOAA MADIS 只应用于美国城市，避免非美国城市串台。\n\n" +
        "图表侧同步修复了预测曲线缺段、首屏 loading 不明显、旧缓存覆盖最新观测等问题。刷新终端后即可使用新逻辑。",
    },
    en: {
      title: "Update: live observations and chart stability",
      body:
        "Live observations are now separated from cached model detail. SSE patches update charts immediately; if SSE is unavailable, the terminal falls back to a lightweight observation fetch every 3-minute interval. DEB, model curves, probabilities, and historical data stay on their own cache path instead of refreshing with every live temperature update.\n\n" +
        "Official observation coverage has also expanded, including Tokyo JMA, Korea AMOS, Turkey MGM, and Taipei CWA. NOAA MADIS is now restricted to US cities to avoid cross-region source leakage.\n\n" +
        "Charts also include fixes for truncated forecast curves, first-load chart loading visibility, and stale cache overriding newer observations. Refresh the terminal to use the new flow.",
    },
  },
];

function isActiveAnnouncement(item: StaticUpdateAnnouncement, now = Date.now()) {
  const expiresAt = Date.parse(item.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const publishedAt = Date.parse(item.publishedAt);
  return !Number.isFinite(publishedAt) || publishedAt <= now;
}

function pickAnnouncementText(payload: StaticUpdateAnnouncement, isEn: boolean) {
  const primary = isEn ? payload.en : payload.zh;
  const fallback = isEn ? payload.zh : payload.en;
  return {
    title: String(primary?.title || fallback?.title || "").trim(),
    body: String(primary?.body || fallback?.body || "").trim(),
  };
}

function formatUpdatedAt(value: string | undefined, isEn: boolean) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(isEn ? "en-US" : "zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UpdateAnnouncementButton({ isEn }: UpdateAnnouncementButtonProps) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const announcement = useMemo(
    () => STATIC_UPDATE_ANNOUNCEMENTS.find((item) => isActiveAnnouncement(item)) ?? null,
    [],
  );
  const text = useMemo(
    () => (announcement ? pickAnnouncementText(announcement, isEn) : { title: "", body: "" }),
    [announcement, isEn],
  );
  const updatedAt = useMemo(
    () => formatUpdatedAt(announcement?.publishedAt, isEn),
    [announcement?.publishedAt, isEn],
  );

  if (!announcement || (!text.title && !text.body)) return null;

  return (
    <div ref={shellRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2 text-[10px] font-bold uppercase tracking-wide text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100"
        title={isEn ? "Update announcement" : "更新公告"}
        aria-expanded={open}
      >
        <Megaphone size={12} />
        {isEn ? "Updates" : "更新公告"}
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-50 w-[min(360px,calc(100vw-32px))] rounded-md border border-slate-200 bg-white p-3 text-left shadow-lg">
          <div className="flex items-start gap-3">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded border border-blue-100 bg-blue-50 text-blue-600">
              <Megaphone size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold leading-5 text-slate-900">
                {text.title || (isEn ? "PolyWeather update" : "PolyWeather 更新")}
              </div>
              {updatedAt && (
                <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                  {isEn ? "Updated" : "更新"} {updatedAt}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
              title={isEn ? "Close" : "关闭"}
            >
              <X size={12} />
            </button>
          </div>
          {text.body && (
            <p className="mt-3 whitespace-pre-line text-[12px] font-medium leading-5 text-slate-600">
              {text.body}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
