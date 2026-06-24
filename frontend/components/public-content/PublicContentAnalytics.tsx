"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

type PublicContentEvent =
  | "brief_view"
  | "brief_cta_click"
  | "methodology_view"
  | "social_outbound_click";

type AnalyticsPayload = Record<string, unknown>;

async function emitPublicContentEvent(
  eventType: PublicContentEvent,
  payload: AnalyticsPayload,
  onceKey?: string,
) {
  const { markAnalyticsOnce, trackAppEvent } = await import("@/lib/app-analytics");
  if (onceKey && !markAnalyticsOnce(`public-content:${onceKey}`)) return;
  trackAppEvent(eventType, payload);
}

export function PublicContentAnalytics({
  eventType,
  onceKey,
  payload,
}: {
  eventType: PublicContentEvent;
  onceKey?: string;
  payload: AnalyticsPayload;
}) {
  const payloadKey = JSON.stringify(payload);

  useEffect(() => {
    const parsedPayload = JSON.parse(payloadKey) as AnalyticsPayload;
    void emitPublicContentEvent(eventType, parsedPayload, onceKey);
  }, [eventType, onceKey, payloadKey]);

  return null;
}

export function PublicContentCta({
  children,
  className,
  href,
  payload,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  payload: AnalyticsPayload;
}) {
  return (
    <Link
      className={className}
      href={href}
      onClick={() => {
        void emitPublicContentEvent("brief_cta_click", payload);
      }}
    >
      {children}
    </Link>
  );
}

export function PublicContentOutboundLink({
  children,
  className,
  href,
  payload,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  payload: AnalyticsPayload;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={() => {
        void emitPublicContentEvent("social_outbound_click", payload);
      }}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
