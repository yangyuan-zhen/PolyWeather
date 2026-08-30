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

const UPDATE_ANNOUNCEMENT_SEEN_KEY = "polyweather_update_announcement_seen_v1";

const STATIC_UPDATE_ANNOUNCEMENTS: StaticUpdateAnnouncement[] = [
  {
    id: "model-summary-table-local-time-2026-06-29",
    publishedAt: "2026-06-29T19:35:00+08:00",
    expiresAt: "2026-08-15T00:00:00+08:00",
    zh: {
      title: "更新公告：模型汇总表上线",
      body:
        "终端左侧新增「模型汇总」菜单，按今日最高温口径汇总全部城市：当地时间、DEB 预测，以及 ECMWF、ECMWF AIFS、GFS、ICON、ICON-EU、GEM、GDPS、JMA、AROME HD、HRRR、NAM 等模型高温预测集中到一张表里。\n\n" +
        "缺失模型会显示 —；模型中位数和分歧范围只基于已有模型值计算，方便快速发现 DEB 与多模型之间的偏离。\n\n" +
        "页面支持搜索城市或模型，并提供「仅 DEB」和「分歧较大」筛选。移动端可横向滚动，首列城市固定。刷新终端后即可使用。",
    },
    en: {
      title: "Update: Model Summary table is live",
      body:
        "The left terminal navigation now includes Model Summary, a city-by-city table for today's high-temperature view: local time, DEB forecast, plus ECMWF, ECMWF AIFS, GFS, ICON, ICON-EU, GEM, GDPS, JMA, AROME HD, HRRR, and NAM model highs in one workspace.\n\n" +
        "Missing models render as —. Model median and spread are calculated only from available model values, making it easier to spot where DEB diverges from the model cluster.\n\n" +
        "The page supports city or model search, plus Only DEB and Large spread filters. Mobile keeps the city column sticky with horizontal table scrolling. Refresh the terminal to use it.",
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

function loadSeenAnnouncementIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(UPDATE_ANNOUNCEMENT_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function saveSeenAnnouncementIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      UPDATE_ANNOUNCEMENT_SEEN_KEY,
      JSON.stringify(Array.from(ids).slice(-50)),
    );
  } catch {
    // Ignore storage failures; the unread dot may reappear but the announcement remains usable.
  }
}

export function UpdateAnnouncementButton({ isEn }: UpdateAnnouncementButtonProps) {
  const [open, setOpen] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [seenLoaded, setSeenLoaded] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSeenIds(loadSeenAnnouncementIds());
    setSeenLoaded(true);
  }, []);

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
  const hasUnread = Boolean(seenLoaded && announcement?.id && !seenIds.has(announcement.id));

  const markAnnouncementAsSeen = (announcementId: string) => {
    setSeenIds((current) => {
      if (current.has(announcementId)) return current;
      const next = new Set(current);
      next.add(announcementId);
      saveSeenAnnouncementIds(next);
      return next;
    });
  };

  if (!announcement || (!text.title && !text.body)) return null;

  return (
    <div ref={shellRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => {
            const next = !value;
            if (next) markAnnouncementAsSeen(announcement.id);
            return next;
          });
        }}
        className="relative inline-flex h-7 items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2 text-[10px] font-bold uppercase tracking-wide text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100"
        title={isEn ? "Update announcement" : "更新公告"}
        aria-label={
          hasUnread
            ? isEn
              ? "Update announcement, unread"
              : "更新公告，有未读内容"
            : isEn
              ? "Update announcement"
              : "更新公告"
        }
        aria-expanded={open}
      >
        <Megaphone size={12} />
        {isEn ? "Updates" : "更新公告"}
        {hasUnread && (
          <span
            className="scan-update-announcement-unread absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white"
            aria-hidden="true"
          />
        )}
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
