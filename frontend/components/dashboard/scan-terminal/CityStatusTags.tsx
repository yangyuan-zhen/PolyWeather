"use client";

import clsx from "clsx";

export type StatusTone = "green" | "blue" | "amber" | "red" | "muted";

export type CityStatusTag = {
  label: string;
  tone: StatusTone;
};

export function CityStatusTags({ tags }: { tags: CityStatusTag[] }) {
  return (
    <div className="scan-ai-city-status-tags">
      {tags.map((tag) => (
        <span
          key={tag.label}
          className={clsx("scan-ai-city-status-tag", tag.tone)}
        >
          {tag.label}
        </span>
      ))}
    </div>
  );
}
