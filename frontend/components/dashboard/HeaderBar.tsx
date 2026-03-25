"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogIn, UserRound } from "lucide-react";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";

export function HeaderBar() {
  const store = useDashboardStore();
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const supabaseReady = hasSupabasePublicEnv();
  const docsHref = "/docs/intro";
  const docsActive = pathname?.startsWith("/docs");

  useEffect(() => {
    let mounted = true;

    if (!supabaseReady) {
      setIsAuthenticated(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setIsAuthenticated(Boolean(data.session?.user?.id));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setIsAuthenticated(Boolean(session?.user?.id));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabaseReady]);

  const accountHref = isAuthenticated
    ? "/account"
    : "/auth/login?next=%2Faccount";
  const accountLabel = isAuthenticated ? t("header.account") : t("header.signIn");
  const accountAria = isAuthenticated
    ? t("header.accountAria")
    : t("header.signInAria");

  return (
    <header className="header">
      <div className="brand">
        <h1>PolyWeather</h1>
        <span className="subtitle">{t("header.subtitle")}</span>
      </div>

      <div className="header-right">
        <div className="lang-switch" role="group" aria-label={t("header.langAria")}>
          <button
            type="button"
            className={clsx("lang-btn", locale === "zh-CN" && "active")}
            onClick={() => setLocale("zh-CN")}
          >
            {t("header.langZh")}
          </button>
          <button
            type="button"
            className={clsx("lang-btn", locale === "en-US" && "active")}
            onClick={() => setLocale("en-US")}
          >
            {t("header.langEn")}
          </button>
        </div>

        <Link
          href={docsHref}
          className={clsx("info-btn", docsActive && "active")}
          title={t("header.docsAria")}
          aria-label={t("header.docsAria")}
        >
          {t("header.docs")}
        </Link>

        <Link
          href={accountHref}
          className="account-btn"
          title={accountAria}
          aria-label={accountAria}
        >
          {isAuthenticated ? <UserRound size={14} /> : <LogIn size={14} />}
          <span>{accountLabel}</span>
        </Link>

        <div className="live-badge" id="liveBadge">
          <span className="pulse-dot" />
          <span>{t("header.live")}</span>
        </div>

        <button
          type="button"
          className={clsx("refresh-btn", store.loadingState.refresh && "spinning")}
          title={t("header.refreshAria")}
          aria-label={t("header.refreshAria")}
          onClick={() => void store.refreshAll()}
        >
          ↻
        </button>
      </div>
    </header>
  );
}
