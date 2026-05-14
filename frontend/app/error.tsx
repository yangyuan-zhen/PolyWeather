"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled page error:", error);
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
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "var(--radius-xl, 20px)",
          backgroundColor: "var(--color-bg-raised, #111A2E)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "0.5rem",
        }}
      >
        <span style={{ fontSize: "1.8rem" }}>⚠</span>
      </div>
      <h1
        style={{
          fontSize: "1.25rem",
          fontWeight: 600,
          margin: 0,
        }}
      >
        页面出错了
      </h1>
      <p
        style={{
          color: "var(--color-text-secondary, #9FB2C7)",
          fontSize: "0.875rem",
          margin: 0,
          maxWidth: 400,
          lineHeight: 1.6,
        }}
      >
        数据处理时遇到了意外问题，请尝试刷新页面。
      </p>
      {error.digest ? (
        <code
          style={{
            fontSize: "0.75rem",
            color: "var(--color-text-muted, #7D8FA3)",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          {error.digest}
        </code>
      ) : null}
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
