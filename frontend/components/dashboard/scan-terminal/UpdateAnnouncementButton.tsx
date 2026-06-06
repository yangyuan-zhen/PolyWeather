"use client";

import { Megaphone, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type AnnouncementText = {
  title?: string;
  body?: string;
};

type UpdateAnnouncementPayload = {
  enabled?: boolean;
  zh?: AnnouncementText;
  en?: AnnouncementText;
  updated_at?: string;
};

type UpdateAnnouncementButtonProps = {
  isEn: boolean;
};

function pickAnnouncementText(payload: UpdateAnnouncementPayload, isEn: boolean) {
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
  const [announcement, setAnnouncement] = useState<UpdateAnnouncementPayload | null>(null);
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAnnouncement() {
      try {
        const res = await fetch("/api/system/update-announcement", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as UpdateAnnouncementPayload;
        if (!cancelled) {
          setAnnouncement(data?.enabled ? data : null);
        }
      } catch {
        if (!cancelled) setAnnouncement(null);
      }
    }
    void loadAnnouncement();
    return () => {
      cancelled = true;
    };
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

  const text = useMemo(
    () => (announcement ? pickAnnouncementText(announcement, isEn) : { title: "", body: "" }),
    [announcement, isEn],
  );
  const updatedAt = useMemo(
    () => formatUpdatedAt(announcement?.updated_at, isEn),
    [announcement?.updated_at, isEn],
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
