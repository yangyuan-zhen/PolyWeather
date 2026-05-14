"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled root error:", error);
  }, [error]);

  return (
    <html lang="zh-CN" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>PolyWeather — 出错了</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "var(--color-bg-base, #0B1220)",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            gap: "1rem",
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
            PolyWeather 遇到了严重错误，请尝试刷新页面。如果问题持续出现，请联系我们。
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
      </body>
    </html>
  );
}
