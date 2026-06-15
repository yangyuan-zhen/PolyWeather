"use client";

import { useEffect, useRef, useState } from "react";
import { getConfiguredTurnstileSiteKey, isTurnstileEnabled } from "@/lib/turnstile-client";

const TURNSTILE_SCRIPT_ID = "polyweather-turnstile-script";
const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_SITE_KEY_ENV = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";

type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

function ensureTurnstileScript(onReady: () => void, onError: () => void) {
  if (typeof window === "undefined") return;
  if (window.turnstile) {
    onReady();
    return;
  }

  const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    existing.addEventListener("load", onReady, { once: true });
    existing.addEventListener("error", onError, { once: true });
    return;
  }

  const script = document.createElement("script");
  script.id = TURNSTILE_SCRIPT_ID;
  script.src = TURNSTILE_SCRIPT_SRC;
  script.async = true;
  script.defer = true;
  script.addEventListener("load", onReady, { once: true });
  script.addEventListener("error", onError, { once: true });
  document.head.appendChild(script);
}

export function TurnstileWidget({
  action,
  onToken,
  onError,
  resetKey,
  theme = "light",
  size = "normal",
}: {
  action: string;
  onToken: (token: string) => void;
  onError?: () => void;
  resetKey?: string | number;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string>("");
  const [scriptReady, setScriptReady] = useState(false);
  const siteKey = getConfiguredTurnstileSiteKey();

  useEffect(() => {
    if (!isTurnstileEnabled()) return;
    ensureTurnstileScript(
      () => setScriptReady(true),
      () => {
        onToken("");
        onError?.();
      },
    );
  }, [onError, onToken]);

  useEffect(() => {
    if (!siteKey || !scriptReady || !containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = "";
    }
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action,
      theme,
      size,
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => {
        onToken("");
        onError?.();
      },
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = "";
      }
    };
  }, [action, onError, onToken, scriptReady, siteKey, size, theme]);

  useEffect(() => {
    if (!resetKey || !widgetIdRef.current || !window.turnstile) return;
    onToken("");
    window.turnstile.reset(widgetIdRef.current);
  }, [onToken, resetKey]);

  if (!siteKey) return null;

  return (
    <div
      ref={containerRef}
      data-turnstile-action={action}
      data-turnstile-site-key-env={TURNSTILE_SITE_KEY_ENV}
      className="min-h-[65px] w-full overflow-hidden"
    />
  );
}
