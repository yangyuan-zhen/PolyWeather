"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";

type Mode = "login" | "signup";

type LoginClientProps = {
  nextPath: string;
};

export function LoginClient({ nextPath }: LoginClientProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [infoText, setInfoText] = useState("");

  const supabaseReady = hasSupabasePublicEnv();

  useEffect(() => {
    if (!supabaseReady) return;
    const run = async () => {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        router.replace(nextPath);
      }
    };
    void run();
  }, [nextPath, router, supabaseReady]);

  const onGoogleSignIn = async () => {
    setErrorText("");
    setInfoText("");
    if (!supabaseReady) {
      setErrorText("Supabase 未配置，无法使用登录");
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        nextPath,
      )}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });
      if (error) {
        setErrorText(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const onEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorText("");
    setInfoText("");
    if (!supabaseReady) {
      setErrorText("Supabase 未配置，无法使用登录");
      return;
    }
    if (!email.trim() || !password.trim()) {
      setErrorText("请输入邮箱和密码");
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setErrorText(error.message);
          return;
        }
        router.replace(nextPath);
        return;
      }

      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        nextPath,
      )}`;
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo,
        },
      });
      if (error) {
        setErrorText(error.message);
        return;
      }
      if (data.session?.user) {
        router.replace(nextPath);
        return;
      }
      setInfoText("注册成功，请检查邮箱并完成验证后登录。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(circle at 18% 15%, #0f2b59 0%, #0a1a39 38%, #050b16 100%)",
        color: "#d8e6ff",
        padding: "24px",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 460,
          borderRadius: 16,
          border: "1px solid rgba(84, 118, 177, 0.45)",
          background: "rgba(8, 18, 37, 0.9)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.4)",
          padding: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>PolyWeather 登录</h1>
        <p style={{ marginTop: 10, color: "#9db5df", lineHeight: 1.5 }}>
          优先推荐 Google 一键登录，邮箱注册/登录可并行使用。
        </p>

        <button
          type="button"
          onClick={() => void onGoogleSignIn()}
          disabled={loading}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid rgba(132, 169, 237, 0.5)",
            background: "linear-gradient(135deg, #1a4c95 0%, #2a6ed2 100%)",
            color: "#f3f7ff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          使用 Google 一键登录
        </button>

        <div style={{ marginTop: 18, marginBottom: 14, color: "#8ea8d8" }}>
          或使用邮箱 {mode === "login" ? "登录" : "注册"}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setMode("login")}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(116, 148, 206, 0.45)",
              background: mode === "login" ? "#1c4a90" : "transparent",
              color: "#d8e6ff",
              cursor: "pointer",
            }}
          >
            邮箱登录
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(116, 148, 206, 0.45)",
              background: mode === "signup" ? "#1c4a90" : "transparent",
              color: "#d8e6ff",
              cursor: "pointer",
            }}
          >
            邮箱注册
          </button>
        </div>

        <form onSubmit={(event) => void onEmailSubmit(event)}>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            style={{
              width: "100%",
              marginBottom: 10,
              padding: "12px",
              borderRadius: 8,
              border: "1px solid rgba(116, 148, 206, 0.4)",
              background: "rgba(10, 23, 47, 0.92)",
              color: "#e6f0ff",
            }}
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 6 位密码"
            style={{
              width: "100%",
              marginBottom: 12,
              padding: "12px",
              borderRadius: 8,
              border: "1px solid rgba(116, 148, 206, 0.4)",
              background: "rgba(10, 23, 47, 0.92)",
              color: "#e6f0ff",
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid rgba(105, 214, 179, 0.55)",
              background: "linear-gradient(135deg, #1b8a71 0%, #1aa387 100%)",
              color: "#f0fffb",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {mode === "login" ? "邮箱登录" : "邮箱注册"}
          </button>
        </form>

        {errorText ? (
          <p style={{ marginTop: 12, color: "#ff8b96" }}>{errorText}</p>
        ) : null}
        {infoText ? (
          <p style={{ marginTop: 12, color: "#77e0be" }}>{infoText}</p>
        ) : null}

        <p style={{ marginTop: 16, color: "#8ea8d8", fontSize: 13 }}>
          登录后将跳转到: <code>{nextPath}</code>
        </p>
      </section>
    </main>
  );
}

