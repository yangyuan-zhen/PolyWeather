"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LandingLocaleToggle } from "@/components/landing/LandingLocaleToggle";
import type { LandingLocale } from "@/components/landing/landingLocale";

let authStatePromise: Promise<boolean> | null = null;

function getLandingAuthState() {
  if (!authStatePromise) {
    authStatePromise = Promise.resolve()
      .then(async () => {
        const { getSupabaseBrowserClient, hasSupabasePublicEnv } = await import(
          "@/lib/supabase/client"
        );
        if (!hasSupabasePublicEnv()) return false;
        const supabase = getSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        return !!session?.user;
      })
      .catch(() => false);
  }
  return authStatePromise;
}

function useLandingAuthState() {
  const [state, setState] = useState({ checked: false, authenticated: false });

  useEffect(() => {
    let active = true;
    getLandingAuthState().then((authenticated) => {
      if (!active) return;
      setState({ checked: true, authenticated });
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
      <path
        d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path
        d="M10 10a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 10 10Zm-5.5 6.4c.7-2.5 2.7-4 5.5-4s4.8 1.5 5.5 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function trackLandingEvent(
  eventType: "enter_terminal" | "login_start",
  payload: Record<string, unknown>,
) {
  void import("@/lib/app-analytics")
    .then(({ trackAppEvent }) => {
      trackAppEvent(eventType, payload);
    })
    .catch(() => {});
}

function trackLoginStart(mode: "login" | "signup") {
  trackLandingEvent("login_start", {
    entry: "landing",
    mode,
    next: "/terminal",
  });
}

function trackEnterTerminal(entry: string, authenticated: boolean) {
  trackLandingEvent("enter_terminal", {
    entry,
    authenticated,
  });
}

function trackTerminalAuthStart(entry: string, mode: "login" | "signup") {
  trackLandingEvent("enter_terminal", {
    entry,
    authenticated: false,
  });
  trackLoginStart(mode);
}

export function LandingHeaderActions({ locale }: { locale: LandingLocale }) {
  const isEn = locale === "en-US";
  const { authenticated, checked } = useLandingAuthState();

  return (
    <div className="flex items-center gap-2">
      <LandingLocaleToggle locale={locale} />

      {!checked ? (
        <div className="h-9 w-24 animate-pulse rounded-md bg-slate-200" />
      ) : authenticated ? (
        <div className="flex items-center gap-2">
          <Link
            href="/terminal"
            onClick={() => trackEnterTerminal("landing_header", true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            {isEn ? "Open" : "进入"}
            <ArrowIcon />
          </Link>
          <Link
            href="/account"
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-950"
            title={isEn ? "Account" : "账户"}
            aria-label={isEn ? "Account" : "账户"}
          >
            <UserIcon />
          </Link>
        </div>
      ) : (
        <>
          <Link
            href="/auth/login?next=%2Fterminal"
            onClick={() => trackTerminalAuthStart("landing_header_login", "login")}
            className="hidden h-9 items-center rounded-md px-3 text-sm font-semibold text-slate-600 hover:text-slate-950 sm:inline-flex"
          >
            {isEn ? "Log in" : "登录"}
          </Link>
          <Link
            href="/auth/login?next=%2Fterminal&mode=signup"
            onClick={() => trackTerminalAuthStart("landing_header_signup", "signup")}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            {isEn ? "Start" : "开始使用"}
            <ArrowIcon />
          </Link>
        </>
      )}
    </div>
  );
}

export function LandingHeroActions({ locale }: { locale: LandingLocale }) {
  const isEn = locale === "en-US";
  const { authenticated, checked } = useLandingAuthState();
  const href = checked && !authenticated ? "/auth/login?next=%2Fterminal" : "/terminal";

  const handleOpenProduct = () => {
    if (checked && !authenticated) {
      trackTerminalAuthStart("landing_hero_login", "login");
      return;
    }
    trackEnterTerminal("landing_hero", authenticated);
  };

  return (
    <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
      <Link
        href={href}
        onClick={handleOpenProduct}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-5 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
      >
        {isEn ? "Open product" : "进入产品"}
        <ArrowIcon />
      </Link>
      <Link
        href="/account"
        className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-950"
      >
        {isEn ? "Subscribe / account" : "订阅 / 账户"}
      </Link>
    </div>
  );
}
