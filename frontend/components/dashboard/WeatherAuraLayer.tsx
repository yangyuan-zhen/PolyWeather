"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import { useDashboardSelection } from "@/hooks/useDashboardStore";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { getWeatherAuraProfile } from "@/lib/weather-aura";

/* ──────────────────────────────────────────────────────────────
   Pure-CSS weather-aura particle layer
   Replaces the former Three.js WebGL implementation with
   CSS @keyframes animations — no canvas, no WebGL.
   ────────────────────────────────────────────────────────────── */

function hexToRgba(hex: string, alpha: number) {
  const sanitized = hex.replace("#", "");
  const normalized =
    sanitized.length === 3
      ? sanitized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : sanitized.padEnd(6, "0");
  const numeric = Number.parseInt(normalized, 16);
  const r = (numeric >> 16) & 255;
  const g = (numeric >> 8) & 255;
  const b = numeric & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ── Injection-safe style IDs ── */

const AURA_STYLE_ID = "poly-aura-keyframes";

/* ── CSS @keyframes (injected once via <style>) ── */

const PARTICLE_KEYFRAMES = `
@keyframes aura-float {
  0%   { transform: translate(0, 0); opacity: 0; }
  10%  { opacity: var(--p-op, 0.5); }
  50%  { transform: translate(var(--p-dx, 40px), var(--p-dy, -15px)); }
  90%  { opacity: var(--p-op, 0.5); }
  100% { transform: translate(calc(var(--p-dx, 40px) * 1.4), var(--p-dy, 5px)); opacity: 0; }
}

@keyframes aura-rain {
  0%   { transform: translateY(-30px); opacity: 0; }
  5%   { opacity: 0.75; }
  100% { transform: translateY(calc(100vh + 30px)); opacity: 0; }
}

@keyframes aura-snow {
  0%   { transform: translate(0, -20px); opacity: 0; }
  15%  { opacity: 0.9; }
  50%  { transform: translate(var(--s-sway, 25px), 50vh); }
  100% { transform: translate(calc(var(--s-sway, 25px) * -1.2), calc(100vh + 20px)); opacity: 0; }
}

@keyframes aura-fog {
  0%   { transform: translateX(-30px); opacity: 0; }
  20%  { opacity: var(--f-op, 0.12); }
  80%  { opacity: var(--f-op, 0.12); }
  100% { transform: translateX(calc(100vw + 30px)); opacity: 0; }
}

@keyframes aura-cloud {
  0%   { transform: translateX(-50px); opacity: 0; }
  20%  { opacity: var(--c-op, 0.1); }
  80%  { opacity: var(--c-op, 0.1); }
  100% { transform: translateX(calc(100vw + 50px)); opacity: 0; }
}

@keyframes aura-storm-flash {
  0%, 100% { opacity: 0; }
  3%  { opacity: 0.18; }
  6%  { opacity: 0; }
  25% { opacity: 0; }
  28% { opacity: 0.12; }
  31% { opacity: 0; }
}

.aura-particle {
  position: absolute;
  pointer-events: none;
  will-change: transform, opacity;
  border-radius: 50%;
}
`;

/* ── Particle config type ── */

interface Particle {
  id: number;
  keyframe: string;
  style: CSSProperties;
}

/* ── Particle generators ── */

function genFloatParticles(
  count: number,
  color: string,
  baseOpacity: number,
  sizeMin: number,
  sizeMax: number,
  idOffset: number,
  intensity: number,
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const size = sizeMin + Math.random() * (sizeMax - sizeMin);
    const op = baseOpacity * (0.35 + Math.random() * 0.65);
    const dx = (15 + Math.random() * 50) * (intensity * 0.75);
    const dy = (-4 - Math.random() * 14) * intensity;
    out.push({
      id: idOffset + i,
      keyframe: "aura-float",
      style: {
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        width: size,
        height: size,
        background: color,
        boxShadow: `0 0 ${size * 3}px ${color}`,
        "--p-op": op,
        "--p-dx": `${dx}px`,
        "--p-dy": `${dy}px`,
        animationDuration: `${10 + Math.random() * 14}s`,
        animationDelay: `${Math.random() * 8}s`,
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        animationName: "aura-float",
        opacity: 0,
      } as unknown as CSSProperties,
    });
  }
  return out;
}

function genRainParticles(
  count: number,
  idOffset: number,
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const h = 8 + Math.random() * 10;
    out.push({
      id: idOffset + i,
      keyframe: "aura-rain",
      style: {
        left: `${Math.random() * 100}%`,
        top: `${-5 - Math.random() * 10}%`,
        width: 1.5,
        height: h,
        borderRadius: "1px",
        background: "linear-gradient(180deg, transparent, rgba(111, 183, 255, 0.85))",
        opacity: 0.5 + Math.random() * 0.4,
        animationDuration: `${0.5 + Math.random() * 0.5}s`,
        animationDelay: `${Math.random() * 2}s`,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationName: "aura-rain",
      } as CSSProperties,
    });
  }
  return out;
}

function genSnowParticles(
  count: number,
  idOffset: number,
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const size = 2.5 + Math.random() * 4.5;
    const sway = 12 + Math.random() * 28;
    out.push({
      id: idOffset + i,
      keyframe: "aura-snow",
      style: {
        left: `${Math.random() * 100}%`,
        top: `${-10 - Math.random() * 15}%`,
        width: size,
        height: size,
        background: "rgba(248, 250, 252, 0.92)",
        boxShadow: `0 0 ${size * 2}px rgba(248, 250, 252, 0.35)`,
        "--s-sway": `${sway}px`,
        opacity: 0.6 + Math.random() * 0.35,
        animationDuration: `${4.5 + Math.random() * 7}s`,
        animationDelay: `${Math.random() * 5}s`,
        animationTimingFunction: "ease-in-out",
        animationIterationCount: "infinite",
        animationName: "aura-snow",
      } as unknown as CSSProperties,
    });
  }
  return out;
}

function genFogParticles(
  count: number,
  intensity: number,
  idOffset: number,
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const w = 40 + Math.random() * 70;
    const h = 18 + Math.random() * 32;
    out.push({
      id: idOffset + i,
      keyframe: "aura-fog",
      style: {
        left: `${-5 - Math.random() * 10}%`,
        top: `${5 + Math.random() * 75}%`,
        width: w,
        height: h,
        background: `radial-gradient(circle, rgba(203, 213, 225, 0.12), transparent 70%)`,
        filter: `blur(${8 + Math.random() * 10}px)`,
        borderRadius: "50%",
        "--f-op": (0.08 + Math.random() * 0.08) * intensity,
        animationDuration: `${18 + Math.random() * 18}s`,
        animationDelay: `${Math.random() * 12}s`,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationName: "aura-fog",
        opacity: 0,
      } as unknown as CSSProperties,
    });
  }
  return out;
}

function genCloudParticles(
  count: number,
  idOffset: number,
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const w = 60 + Math.random() * 90;
    const h = 22 + Math.random() * 38;
    out.push({
      id: idOffset + i,
      keyframe: "aura-cloud",
      style: {
        left: `${-10 - Math.random() * 15}%`,
        top: `${5 + Math.random() * 45}%`,
        width: w,
        height: h,
        background: `radial-gradient(circle, rgba(219, 234, 254, 0.08), transparent 70%)`,
        filter: `blur(${14 + Math.random() * 12}px)`,
        borderRadius: "50%",
        "--c-op": 0.06 + Math.random() * 0.06,
        animationDuration: `${28 + Math.random() * 22}s`,
        animationDelay: `${Math.random() * 14}s`,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationName: "aura-cloud",
        opacity: 0,
      } as unknown as CSSProperties,
    });
  }
  return out;
}

function genWindParticles(
  count: number,
  color: string,
  idOffset: number,
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const size = 1.5 + Math.random() * 2.5;
    out.push({
      id: idOffset + i,
      keyframe: "aura-float",
      style: {
        left: `${-5 - Math.random() * 8}%`,
        top: `${Math.random() * 100}%`,
        width: size,
        height: size,
        background: color,
        boxShadow: `0 0 ${size * 2}px ${color}`,
        "--p-op": 0.35 + Math.random() * 0.3,
        "--p-dx": `${120 + Math.random() * 180}px`,
        "--p-dy": `${-2 + Math.random() * 4}px`,
        animationDuration: `${2.5 + Math.random() * 3.5}s`,
        animationDelay: `${Math.random() * 3}s`,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationName: "aura-float",
        opacity: 0,
      } as unknown as CSSProperties,
    });
  }
  return out;
}

/* ── Component ── */

export function WeatherAuraLayer() {
  const { cities, selectedDetail } = useDashboardSelection();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isDesktop, setIsDesktop] = useState(false);

  const aura = getWeatherAuraProfile(selectedDetail, cities);

  /* Inject keyframes once */
  useEffect(() => {
    if (document.getElementById(AURA_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = AURA_STYLE_ID;
    el.textContent = PARTICLE_KEYFRAMES;
    document.head.appendChild(el);
    return () => {
      const existing = document.getElementById(AURA_STYLE_ID);
      if (existing) existing.remove();
    };
  }, []);

  /* Desktop media query */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /* Build particles */
  const particles = useMemo(() => {
    if (!isDesktop || prefersReducedMotion) return [];
    const list: Particle[] = [];

    /* Primary float layer */
    list.push(
      ...genFloatParticles(30, aura.primary, aura.particleOpacity * 0.9, 2, 4, 0, aura.intensity),
    );
    /* Secondary float layer */
    list.push(
      ...genFloatParticles(
        20,
        aura.secondary,
        aura.particleOpacity * 0.6,
        3,
        6,
        100,
        aura.intensity * 0.8,
      ),
    );

    switch (aura.effect) {
      case "rain": {
        list.push(...genRainParticles(25, 200));
        break;
      }
      case "storm": {
        list.push(...genRainParticles(35, 200));
        break;
      }
      case "snow": {
        list.push(...genSnowParticles(25, 200));
        break;
      }
      case "fog": {
        list.push(...genFogParticles(15, aura.effectIntensity, 200));
        break;
      }
      case "cloud": {
        list.push(...genCloudParticles(12, 200));
        break;
      }
      case "wind": {
        list.push(...genWindParticles(30, aura.primary, 200));
        break;
      }
    }

    /* Storm flash overlay */
    if (aura.effect === "storm") {
      list.push({
        id: 999,
        keyframe: "aura-storm-flash",
        style: {
          position: "absolute" as const,
          inset: 0,
          width: "100%",
          height: "100%",
          borderRadius: 0,
          background:
            "radial-gradient(ellipse at 50% 30%, rgba(219, 234, 254, 0.25), transparent 60%)",
          animationDuration: "4s",
          animationTimingFunction: "step-end",
          animationIterationCount: "infinite",
          animationName: "aura-storm-flash",
          opacity: 0,
        } as CSSProperties,
      });
    }

    return list;
  }, [aura, isDesktop, prefersReducedMotion]);

  if (!isDesktop) {
    return null;
  }

  const overlayStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    pointerEvents: "none",
    opacity: 0.96,
    overflow: "hidden",
    backgroundImage: [
      `radial-gradient(circle at 18% 22%, ${hexToRgba(aura.primary, 0.18 * aura.intensity)}, transparent 32%)`,
      `radial-gradient(circle at 78% 20%, ${hexToRgba(aura.secondary, 0.14 * aura.intensity)}, transparent 34%)`,
      `radial-gradient(circle at 52% 78%, ${hexToRgba(aura.tertiary, 0.12 * aura.intensity)}, transparent 38%)`,
      aura.effect === "rain" || aura.effect === "storm"
        ? `linear-gradient(180deg, ${hexToRgba("#6FB7FF", 0.06 * aura.effectIntensity)}, transparent 45%)`
        : aura.effect === "snow"
          ? `linear-gradient(180deg, ${hexToRgba("#e2e8f0", 0.06 * aura.effectIntensity)}, transparent 45%)`
          : aura.effect === "fog"
            ? `radial-gradient(circle at 50% 56%, ${hexToRgba("#cbd5e1", 0.08 * aura.effectIntensity)}, transparent 60%)`
            : aura.effect === "cloud"
              ? `linear-gradient(180deg, ${hexToRgba("#dbeafe", 0.04 * aura.effectIntensity)}, transparent 40%)`
              : "none",
    ].join(", "),
  };

  const scrimStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundImage: [
      "linear-gradient(180deg, rgba(3, 8, 19, 0.64) 0%, rgba(5, 10, 20, 0.16) 24%, rgba(4, 8, 18, 0.1) 54%, rgba(3, 6, 14, 0.42) 100%)",
      "radial-gradient(circle at 50% 60%, rgba(0, 224, 164, 0.08) 0%, rgba(123, 97, 255, 0) 48%)",
    ].join(", "),
  };

  return (
    <div
      aria-hidden="true"
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      style={overlayStyle}
    >
      {particles.map((p) => (
        <div key={p.id} className="aura-particle" style={p.style} />
      ))}
      <div style={scrimStyle} />
    </div>
  );
}
