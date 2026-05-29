"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Lock } from "lucide-react";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";
import { useI18n } from "@/hooks/useI18n";

type ResetPasswordClientProps = {
  nextPath: string;
};

export function ResetPasswordClient({ nextPath }: ResetPasswordClientProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const supabaseReady = hasSupabasePublicEnv();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [infoText, setInfoText] = useState("");

  const copy = {
    title: isEn ? "Set a new password" : "设置新密码",
    subtitle: isEn
      ? "Create a password for your PolyWeather account."
      : "为您的 PolyWeather 账户创建一个新密码。",
    password: isEn ? "New password" : "新密码",
    confirmPassword: isEn ? "Confirm password" : "确认密码",
    passwordPlaceholder: isEn ? "At least 6 characters" : "至少 6 位字符",
    confirmPlaceholder: isEn ? "Enter it again" : "再次输入新密码",
    submit: isEn ? "Update password" : "更新密码",
    checking: isEn ? "Checking reset link..." : "正在检查重置链接...",
    expired: isEn
      ? "This reset link is expired or invalid. Please request a new password reset email."
      : "重置链接已过期或无效，请重新发送密码重置邮件。",
    supabaseMissing: isEn
      ? "Supabase is not configured. Password reset is unavailable."
      : "Supabase 未配置，无法重置密码。",
    passwordTooShort: isEn
      ? "Password must be at least 6 characters."
      : "密码至少需要 6 位字符。",
    passwordMismatch: isEn
      ? "The two passwords do not match."
      : "两次输入的密码不一致。",
    success: isEn
      ? "Password updated. Redirecting..."
      : "密码已更新，正在跳转...",
    backLogin: isEn ? "Back to sign in" : "返回登录",
  } as const;

  useEffect(() => {
    if (!supabaseReady) {
      setErrorText(copy.supabaseMissing);
      setCheckingSession(false);
      return;
    }

    const run = async () => {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const hasRecoverySession = Boolean(session?.user);
      setHasSession(hasRecoverySession);
      if (!hasRecoverySession) {
        setErrorText(copy.expired);
      }
      setCheckingSession(false);
    };

    void run();
  }, [copy.expired, copy.supabaseMissing, supabaseReady]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorText("");
    setInfoText("");

    if (!hasSession) {
      setErrorText(copy.expired);
      return;
    }
    if (password.length < 6) {
      setErrorText(copy.passwordTooShort);
      return;
    }
    if (password !== confirmPassword) {
      setErrorText(copy.passwordMismatch);
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorText(error.message);
        return;
      }
      setInfoText(copy.success);
      window.setTimeout(() => router.replace(nextPath), 700);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-900">
      <div className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(8,16,36,0.08)] sm:p-8">
        <Link href="/" className="mb-8 inline-flex items-center">
          <img src="/logo.png" alt="PolyWeather" className="h-8 w-auto object-contain" />
        </Link>

        <div className="mb-6 space-y-2">
          <h1 className="text-2xl font-black tracking-tight">{copy.title}</h1>
          <p className="text-sm leading-6 text-slate-500">{copy.subtitle}</p>
        </div>

        {checkingSession ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
            {copy.checking}
          </div>
        ) : (
          <form onSubmit={(event) => void onSubmit(event)} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {copy.password}
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  minLength={6}
                  required
                  disabled={!hasSession || loading}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={copy.passwordPlaceholder}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-3 pl-11 pr-11 text-sm text-slate-900 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={!hasSession || loading}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {copy.confirmPassword}
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  minLength={6}
                  required
                  disabled={!hasSession || loading}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={copy.confirmPlaceholder}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-3 pl-11 pr-11 text-sm text-slate-900 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  disabled={!hasSession || loading}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={!hasSession || loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-950/10 transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>{copy.submit}</span>
              <ArrowRight size={16} />
            </button>
          </form>
        )}

        {errorText ? (
          <div className="mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorText}</span>
          </div>
        ) : null}
        {infoText ? (
          <div className="mt-4 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs leading-5 text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{infoText}</span>
          </div>
        ) : null}

        <Link
          href="/auth/login"
          className="mt-5 inline-flex text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
        >
          {copy.backLogin}
        </Link>
      </div>
    </main>
  );
}
