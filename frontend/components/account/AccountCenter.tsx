"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserCircle2,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";
import styles from "./AccountCenter.module.css";

type AuthMeResponse = {
  authenticated?: boolean;
  user_id?: string | null;
  email?: string | null;
  entitlement_mode?: string | null;
  auth_required?: boolean;
  subscription_required?: boolean;
  subscription_active?: boolean | null;
};

function formatTime(value: string | undefined | null, locale: string) {
  if (!value) return "";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dt);
  } catch {
    return "";
  }
}

function normalizeProvider(user: User | null) {
  const provider = String(user?.app_metadata?.provider || "").trim().toLowerCase();
  if (provider) return provider;
  const providers = user?.app_metadata?.providers;
  if (Array.isArray(providers) && providers.length) {
    return String(providers[0] || "").trim().toLowerCase();
  }
  return "";
}

export function AccountCenter() {
  const { locale, t } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [copied, setCopied] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [user, setUser] = useState<User | null>(null);
  const [backend, setBackend] = useState<AuthMeResponse | null>(null);

  const supabaseReady = hasSupabasePublicEnv();

  const loadSnapshot = useCallback(async () => {
    setErrorText("");
    try {
      const userPromise = supabaseReady
        ? getSupabaseBrowserClient().auth.getUser()
        : Promise.resolve({ data: { user: null as User | null } });
      const backendPromise = fetch("/api/auth/me", { cache: "no-store" });

      const [userResult, backendResult] = await Promise.all([
        userPromise,
        backendPromise,
      ]);

      setUser(userResult.data?.user ?? null);

      if (!backendResult.ok) {
        const raw = (await backendResult.text()).slice(0, 240);
        throw new Error(`HTTP ${backendResult.status} ${raw}`.trim());
      }
      const backendJson = (await backendResult.json()) as AuthMeResponse;
      setBackend(backendJson);
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      setErrorText(String(error));
    }
  }, [supabaseReady]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      await loadSnapshot();
      if (!cancelled) setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSnapshot();
    setRefreshing(false);
  };

  const onSignOut = async () => {
    if (supabaseReady) {
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.signOut();
      } catch {}
    }
    router.replace("/auth/login");
  };

  const userId = backend?.user_id || user?.id || "";
  const isAuthenticated = Boolean(userId);
  const email = backend?.email || user?.email || "";
  const providerRaw = normalizeProvider(user);
  const provider = providerRaw ? providerRaw.toUpperCase() : t("account.na");
  const lastSignIn = formatTime(user?.last_sign_in_at, locale) || t("account.na");
  const updatedAtLabel = formatTime(updatedAt, locale) || t("account.na");
  const displayName =
    String(user?.user_metadata?.full_name || "").trim() ||
    (email ? String(email).split("@")[0] : "") ||
    t("account.guestName");
  const initials = displayName.slice(0, 2).toUpperCase();

  const modeLabel = useMemo(() => {
    const mode = String(backend?.entitlement_mode || "").trim().toLowerCase();
    if (mode === "supabase_required") return t("account.mode.supabaseRequired");
    if (mode === "supabase_optional") return t("account.mode.supabaseOptional");
    if (mode === "supabase") return t("account.mode.supabase");
    if (mode === "legacy_token") return t("account.mode.legacy");
    if (mode === "disabled") return t("account.mode.disabled");
    return t("account.mode.unknown");
  }, [backend?.entitlement_mode, t]);

  const subscriptionLabel = useMemo(() => {
    if (!backend?.subscription_required) return t("account.subscription.notRequired");
    if (backend.subscription_active === true) return t("account.subscription.active");
    if (backend.subscription_active === false) return t("account.subscription.inactive");
    return t("account.subscription.unknown");
  }, [backend?.subscription_active, backend?.subscription_required, t]);

  const bindCommand = userId
    ? `/bind ${userId}${email ? ` ${email}` : ""}`
    : "/bind <supabase_user_id> <email>";

  const copyBindCommand = async () => {
    try {
      await navigator.clipboard.writeText(bindCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {}
  };

  return (
    <main className={styles.page}>
      <div className={styles.aurora} />
      <div className={styles.gridNoise} />
      <div className={styles.shell}>
        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            <h1 className={styles.title}>{t("account.title")}</h1>
            <p className={styles.subtitle}>{t("account.subtitle")}</p>
          </div>
          <div className={styles.actions}>
            <Link className={styles.ghostBtn} href="/">
              <ArrowLeft size={15} />
              {t("account.backDashboard")}
            </Link>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => void onRefresh()}
              disabled={refreshing || loading}
            >
              {refreshing ? <Loader2 size={15} className={styles.spin} /> : <RefreshCw size={15} />}
              {t("account.refresh")}
            </button>
            {isAuthenticated ? (
              <button type="button" className={styles.primaryBtn} onClick={() => void onSignOut()}>
                <LogOut size={15} />
                {t("account.signOut")}
              </button>
            ) : (
              <Link className={styles.primaryBtn} href="/auth/login?next=%2Faccount">
                <LogIn size={15} />
                {t("account.signIn")}
              </Link>
            )}
          </div>
        </header>

        <section className={styles.heroCard}>
          <div className={styles.avatar}>{initials || "PW"}</div>
          <div className={styles.heroMain}>
            <h2>{displayName}</h2>
            <p>{email || t("account.na")}</p>
            <div className={styles.badges}>
              {isAuthenticated ? (
                <>
                  <span className={styles.badge}>
                    <CheckCircle2 size={14} />
                    {t("account.authenticated")}
                  </span>
                  {backend?.subscription_active ? (
                    <span className={styles.badge}>
                      <ShieldCheck size={14} />
                      {t("account.subscriptionActive")}
                    </span>
                  ) : backend?.subscription_required ? (
                    <span className={styles.badgeWarn}>
                      <KeyRound size={14} />
                      {t("account.subscriptionRequired")}
                    </span>
                  ) : (
                    <span className={styles.badgeGhost}>
                      <ShieldCheck size={14} />
                      {t("account.subscriptionUnknown")}
                    </span>
                  )}
                </>
              ) : (
                <span className={styles.badgeGhost}>
                  <ShieldCheck size={14} />
                  {t("account.guest")}
                </span>
              )}
            </div>
          </div>
          <div className={styles.updatedText}>{t("account.updatedAt", { time: updatedAtLabel })}</div>
        </section>

        {loading ? (
          <section className={styles.noticeRow}>
            <Loader2 size={16} className={styles.spin} />
            <span>{t("account.loading")}</span>
          </section>
        ) : null}

        {errorText ? (
          <section className={styles.errorRow}>
            {t("account.error", { message: errorText })}
          </section>
        ) : null}

        <section className={styles.cards}>
          <article className={styles.card}>
            <h3>
              <ShieldCheck size={17} />
              {t("account.card.membership")}
            </h3>
            <dl className={styles.metaList}>
              <div>
                <dt>{t("account.field.mode")}</dt>
                <dd>{modeLabel}</dd>
              </div>
              <div>
                <dt>{t("account.field.backendStatus")}</dt>
                <dd>
                  {backend?.authenticated
                    ? t("account.backend.ok")
                    : backend?.auth_required
                    ? t("account.backend.fail")
                    : t("account.guest")}
                </dd>
              </div>
              <div>
                <dt>{t("account.field.requirement")}</dt>
                <dd>
                  {backend?.subscription_required
                    ? t("account.subscriptionRequired")
                    : t("account.subscription.notRequired")}
                </dd>
              </div>
              <div>
                <dt>{t("account.field.subscription")}</dt>
                <dd>{subscriptionLabel}</dd>
              </div>
            </dl>
          </article>

          <article className={styles.card}>
            <h3>
              <UserCircle2 size={17} />
              {t("account.card.identity")}
            </h3>
            <dl className={styles.metaList}>
              <div>
                <dt>{t("account.field.email")}</dt>
                <dd>{email || t("account.na")}</dd>
              </div>
              <div>
                <dt>{t("account.field.userId")}</dt>
                <dd className={styles.mono}>{userId || t("account.na")}</dd>
              </div>
              <div>
                <dt>{t("account.field.provider")}</dt>
                <dd>{provider}</dd>
              </div>
              <div>
                <dt>{t("account.field.lastSignIn")}</dt>
                <dd>{lastSignIn}</dd>
              </div>
            </dl>
          </article>

          <article className={styles.cardWide}>
            <h3>
              <Bot size={17} />
              {t("account.card.bot")}
            </h3>
            <p className={styles.hint}>{t("account.field.bindHint")}</p>
            <div className={styles.commandRow}>
              <code className={styles.command}>{bindCommand}</code>
              <button type="button" className={styles.copyBtn} onClick={() => void copyBindCommand()}>
                <Copy size={14} />
                {copied ? t("account.copied") : t("account.copy")}
              </button>
            </div>
          </article>
        </section>

        {!supabaseReady ? (
          <section className={styles.noticeRow}>
            <KeyRound size={15} />
            <span>NEXT_PUBLIC_SUPABASE_URL / ANON_KEY is not configured.</span>
          </section>
        ) : null}
      </div>
    </main>
  );
}
