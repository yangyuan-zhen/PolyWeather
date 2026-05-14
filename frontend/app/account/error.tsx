"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function AccountErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Account page error:", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
        gap: "1rem",
        backgroundColor: "var(--color-bg-base, #0B1220)",
        color: "var(--color-text-primary, #E6EDF3)",
        fontFamily: "var(--font-data, Inter, sans-serif)",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontSize: "1.25rem",
          fontWeight: 600,
          margin: 0,
          color: "var(--color-accent-primary, #4DA3FF)",
        }}
      >
        账户页面出错
      </h1>
      <p
        style={{
          color: "var(--color-text-secondary, #9FB2C7)",
          fontSize: "0.875rem",
          margin: 0,
          maxWidth: 420,
          lineHeight: 1.7,
        }}
      >
        如果是在支付或绑定钱包时出现此问题，常见原因是钱包插件冲突（例如同时开启了 MetaMask 和
        Rabby）。请尝试关闭其他钱包插件后刷新页面重试。
      </p>
      <p
        style={{
          color: "var(--color-text-muted, #7D8FA3)",
          fontSize: "0.8rem",
          margin: 0,
          maxWidth: 420,
          lineHeight: 1.6,
        }}
      >
        If this happened during payment or wallet binding, the most common cause is
        conflicting wallet extensions. Try disabling other wallet extensions (e.g.
        MetaMask + Rabby) and refresh.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: "0.5rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1.25rem",
          borderRadius: "var(--radius-md, 10px)",
          border: "1px solid var(--color-border-default, rgba(159,178,199,0.16))",
          backgroundColor: "var(--color-bg-raised, #111A2E)",
          color: "var(--color-accent-primary, #4DA3FF)",
          cursor: "pointer",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        <RefreshCw size={14} />
        重试
      </button>
    </div>
  );
}
