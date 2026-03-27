"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { getWeatherAuraProfile } from "@/lib/weather-aura";
import styles from "./Dashboard.module.css";

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

export function WeatherAuraLayer() {
  const store = useDashboardStore();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isDesktop, setIsDesktop] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const aura = getWeatherAuraProfile(store.selectedDetail, store.cities);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      setIsDesktop(mediaQuery.matches);
    };

    apply();
    mediaQuery.addEventListener("change", apply);
    return () => {
      mediaQuery.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !isDesktop || prefersReducedMotion) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;

    const clock = new THREE.Clock();
    const particleGroups: Array<{
      geometry: THREE.BufferGeometry;
      positions: Float32Array;
      baseY: Float32Array;
      drift: Float32Array;
      phase: Float32Array;
    }> = [];

    function createParticleField(
      count: number,
      pointSize: number,
      opacity: number,
      depthShift: number,
    ) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const baseY = new Float32Array(count);
      const drift = new Float32Array(count);
      const phase = new Float32Array(count);
      const primaryColor = new THREE.Color(aura.primary);
      const secondaryColor = new THREE.Color(aura.secondary);
      const tertiaryColor = new THREE.Color(aura.tertiary);

      for (let index = 0; index < count; index += 1) {
        const offset = index * 3;
        const x = Math.random() * 2.6 - 1.3;
        const y = Math.random() * 1.8 - 0.9;
        const z = (Math.random() * 0.8 - 0.4) + depthShift;
        positions[offset] = x;
        positions[offset + 1] = y;
        positions[offset + 2] = z;
        baseY[index] = y;
        drift[index] = (0.00045 + Math.random() * 0.0012) * aura.drift;
        phase[index] = Math.random() * Math.PI * 2;

        const mixedColor = primaryColor
          .clone()
          .lerp(secondaryColor, Math.random() * 0.65)
          .lerp(tertiaryColor, Math.random() * 0.4);
        colors[offset] = mixedColor.r;
        colors[offset + 1] = mixedColor.g;
        colors[offset + 2] = mixedColor.b;
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({
        size: pointSize,
        transparent: true,
        opacity,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });

      const points = new THREE.Points(geometry, material);
      scene.add(points);
      particleGroups.push({ geometry, positions, baseY, drift, phase });
    }

    createParticleField(90, 0.018, aura.particleOpacity * 0.9, -0.1);
    createParticleField(60, 0.026, aura.particleOpacity * 0.65, 0.08);

    const resize = () => {
      const width = host.clientWidth || window.innerWidth;
      const height = host.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
    };

    resize();
    host.appendChild(renderer.domElement);

    let frameId = 0;
    let lastFrameAt = 0;

    const renderFrame = (timestamp: number) => {
      frameId = window.requestAnimationFrame(renderFrame);
      if (timestamp - lastFrameAt < 40) {
        return;
      }
      lastFrameAt = timestamp;

      const elapsed = clock.getElapsedTime();
      for (const field of particleGroups) {
        for (let index = 0; index < field.baseY.length; index += 1) {
          const offset = index * 3;
          let nextX = field.positions[offset] + field.drift[index];
          if (nextX > 1.35) {
            nextX = -1.35;
            field.baseY[index] = Math.random() * 1.8 - 0.9;
          }
          field.positions[offset] = nextX;
          field.positions[offset + 1] =
            field.baseY[index] +
            Math.sin(elapsed * 0.45 + field.phase[index] + nextX * 2.4) *
              0.06 *
              aura.intensity;
        }

        field.geometry.attributes.position.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };

    frameId = window.requestAnimationFrame(renderFrame);
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      for (const child of [...scene.children]) {
        scene.remove(child);
      }
      for (const field of particleGroups) {
        field.geometry.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [
    aura.drift,
    aura.intensity,
    aura.particleOpacity,
    aura.primary,
    aura.secondary,
    aura.tertiary,
    isDesktop,
    prefersReducedMotion,
  ]);

  if (!isDesktop) {
    return null;
  }

  const overlayStyle = {
    backgroundImage: [
      `radial-gradient(circle at 18% 22%, ${hexToRgba(aura.primary, 0.18 * aura.intensity)}, transparent 32%)`,
      `radial-gradient(circle at 78% 20%, ${hexToRgba(aura.secondary, 0.14 * aura.intensity)}, transparent 34%)`,
      `radial-gradient(circle at 52% 78%, ${hexToRgba(aura.tertiary, 0.12 * aura.intensity)}, transparent 38%)`,
    ].join(", "),
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={styles.weatherAura}
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      style={overlayStyle}
    >
      <div className={styles.weatherAuraScrim} />
    </div>
  );
}
