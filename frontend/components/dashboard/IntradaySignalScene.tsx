"use client";

import { CSSProperties, useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export interface IntradaySignalMetric {
  key: string;
  label: string;
  value: string;
  hint: string;
  fill: number | null;
  tone: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getToneColor(tone: string) {
  if (tone === "cyan") return "#4DA3FF";
  if (tone === "blue") return "#60a5fa";
  if (tone === "amber") return "#f59e0b";
  return "#9FB2C7";
}

function hexToRgba(hex: string, alpha: number) {
  const sanitized = hex.replace("#", "");
  const numeric = Number.parseInt(sanitized.padEnd(6, "0"), 16);
  const r = (numeric >> 16) & 255;
  const g = (numeric >> 8) & 255;
  const b = numeric & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ── Draw a rounded-rect path (polyfill-safe) ── */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | [number, number, number, number],
) {
  const corners = typeof r === "number" ? [r, r, r, r] : r;
  const [tl, tr, br, bl] = corners;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

/* ── Component ── */

export function IntradaySignalScene({
  metrics,
  score,
}: {
  metrics: IntradaySignalMetric[];
  score: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;display:block;";
    host.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    let animationId = 0;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let startTime = performance.now();

    const render = (now: number) => {
      animationId = requestAnimationFrame(render);

      const W = host.clientWidth;
      const H = host.clientHeight;
      if (W < 1 || H < 1) return;

      ctx.clearRect(0, 0, W, H);

      const elapsed = prefersReducedMotion ? 0 : (now - startTime) / 1000;

      /* ── Layout ── */
      const cx = W / 2;
      const floorY = Math.max(H - 28, H * 0.78);
      const rx = clamp(Math.min(W / 2 - 24, 160), 60, 160);
      const ry = clamp(rx * 0.28, 12, 26);

      const isPositive = score >= 0;
      const accentColor = isPositive ? "#4DA3FF" : "#F59E0B";
      const floorGlowColor = isPositive ? "#0e7490" : "#b45309";
      const floorBaseColor = isPositive ? "#10263b" : "#2c1d12";

      /* ── Floor ── */
      const floorGrad = ctx.createRadialGradient(cx, floorY, 0, cx, floorY, rx);
      floorGrad.addColorStop(0, hexToRgba(floorGlowColor, 0.55));
      floorGrad.addColorStop(0.5, floorBaseColor);
      floorGrad.addColorStop(1, "#060e1a");

      ctx.beginPath();
      ctx.ellipse(cx, floorY, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = floorGrad;
      ctx.fill();

      /* Floor glow overlay */
      const floorGlow = ctx.createRadialGradient(cx, floorY, 0, cx, floorY, rx * 0.6);
      floorGlow.addColorStop(0, hexToRgba(accentColor, 0.08));
      floorGlow.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.ellipse(cx, floorY, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = floorGlow;
      ctx.fill();

      /* ── Ring (oscillating opacity) ── */
      const ringOpacity = 0.38 + Math.sin(elapsed * 0.8) * 0.1;
      ctx.beginPath();
      ctx.ellipse(cx, floorY, rx - 10, Math.max(ry - 3, 8), 0, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(accentColor, ringOpacity);
      ctx.lineWidth = 2.5;
      ctx.stroke();

      /* ── Bar positions ── */
      const barSpacing = rx * 0.48;
      const xPositions = [
        cx - barSpacing,
        cx - barSpacing / 3,
        cx + barSpacing / 3,
        cx + barSpacing,
      ];
      const barWidth = Math.min(26, rx * 0.16);
      const limitedMetrics = metrics.slice(0, 4);

      /* ── Draw bars ── */
      limitedMetrics.forEach((metric, i) => {
        const fill = metric.fill ?? 20;
        const height = Math.max(12, 14 + (fill / 100) * (floorY - 55));
        const bx = xPositions[i];
        const by = floorY - height;
        const color = getToneColor(metric.tone);
        const baseGlow = prefersReducedMotion
          ? 1
          : 1 + Math.sin(elapsed * 1.2 + i) * 0.06;

        /* Base glow ellipse */
        const glowGrad = ctx.createRadialGradient(bx, floorY, 0, bx, floorY, barWidth * 1.2);
        glowGrad.addColorStop(0, hexToRgba(color, 0.35));
        glowGrad.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.ellipse(bx, floorY, barWidth * baseGlow, 7 * baseGlow, 0, 0, Math.PI * 2);
        ctx.fillStyle = glowGrad;
        ctx.fill();

        /* Bar body (rounded top) */
        const barGrad = ctx.createLinearGradient(bx, by, bx, floorY);
        barGrad.addColorStop(0, color);
        barGrad.addColorStop(0.55, color);
        barGrad.addColorStop(1, hexToRgba(color, 0.3));
        roundRect(ctx, bx - barWidth / 2, by, barWidth, height, [4, 4, 0, 0]);
        ctx.fillStyle = barGrad;
        ctx.fill();

        /* Bar glow outline */
        ctx.strokeStyle = hexToRgba(color, 0.15);
        ctx.lineWidth = 1;
        roundRect(ctx, bx - barWidth / 2 - 1, by - 1, barWidth + 2, height + 2, [5, 5, 0, 0]);
        ctx.stroke();

        /* Cap (pulse offset per bar) */
        const pulse = prefersReducedMotion
          ? 0
          : Math.sin(elapsed * 1.5 + i * 0.8) * 3;
        const capY = by + pulse;
        const capR = Math.max(5, barWidth * 0.22);

        /* Cap outer glow */
        const capGlow = ctx.createRadialGradient(bx, capY, 0, bx, capY, capR * 3);
        capGlow.addColorStop(0, hexToRgba(color, 0.2));
        capGlow.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(bx, capY, capR * 3, 0, Math.PI * 2);
        ctx.fillStyle = capGlow;
        ctx.fill();

        /* Cap body */
        ctx.beginPath();
        ctx.arc(bx, capY, capR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = capR * 2;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      /* ── Ambient sparkle dots (only when not reduced motion) ── */
      if (!prefersReducedMotion) {
        for (let i = 0; i < 6; i++) {
          const angle = elapsed * 0.25 + i * 1.05;
          const dist = rx * 0.7 + Math.sin(elapsed * 0.15 + i * 2.3) * 10;
          const sx = cx + Math.cos(angle) * dist;
          const sy = floorY - ry * 0.4 + Math.sin(angle) * dist * 0.35;
          const sparkleSize = 1.5 + Math.sin(elapsed * 2 + i * 1.7) * 0.8;
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(0.5, sparkleSize), 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(accentColor, 0.12 + Math.sin(elapsed * 1.3 + i) * 0.06);
          ctx.fill();
        }
      }
    }

    animationId = requestAnimationFrame(render);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationId);
      if (canvas.parentNode === host) {
        host.removeChild(canvas);
      }
    };
  }, [metrics, prefersReducedMotion, score]);

  return (
    <div className="intraday-scene-shell">
      <div
        ref={containerRef}
        className="intraday-scene-frame"
        aria-hidden="true"
      />
      <div className="intraday-scene-legend">
        {metrics.slice(0, 4).map((metric) => (
          <div key={metric.key} className="intraday-scene-chip">
            <span
              className="intraday-scene-chip-dot"
              style={{ backgroundColor: getToneColor(metric.tone) } as CSSProperties}
            />
            <div className="intraday-scene-chip-copy">
              <strong>{metric.label}</strong>
              <span>
                {metric.value} · {metric.hint}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
