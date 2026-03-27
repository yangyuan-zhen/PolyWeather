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
    const cleanupMaterials = new Set<THREE.Material>();
    const particleGroups: Array<{
      kind: "flow" | "rain" | "snow" | "fog" | "cloud";
      geometry: THREE.BufferGeometry;
      positions: Float32Array;
      baseY: Float32Array;
      drift: Float32Array;
      phase: Float32Array;
      material: THREE.Material;
      mesh: THREE.Object3D;
    }> = [];
    const effectLights: THREE.Light[] = [];
    const flashOverlay = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#e0f2fe"),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      }),
    );
    flashOverlay.position.z = -0.3;
    scene.add(flashOverlay);
    cleanupMaterials.add(flashOverlay.material as THREE.Material);

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
      cleanupMaterials.add(material);
      particleGroups.push({
        geometry,
        positions,
        baseY,
        drift,
        phase,
        kind: "flow",
        material,
        mesh: points,
      });
    }

    function createRainField(count: number) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const baseY = new Float32Array(count);
      const drift = new Float32Array(count);
      const phase = new Float32Array(count);

      for (let index = 0; index < count; index += 1) {
        const offset = index * 3;
        positions[offset] = Math.random() * 2.8 - 1.4;
        positions[offset + 1] = Math.random() * 2.2 - 1.1;
        positions[offset + 2] = Math.random() * 0.4 - 0.2;
        baseY[index] = positions[offset + 1];
        drift[index] = (0.018 + Math.random() * 0.016) * aura.effectIntensity;
        phase[index] = 0.004 + Math.random() * 0.004;
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.018,
        color: new THREE.Color("#7dd3fc"),
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      scene.add(points);
      cleanupMaterials.add(material);
      particleGroups.push({
        geometry,
        positions,
        baseY,
        drift,
        phase,
        kind: "rain",
        material,
        mesh: points,
      });
    }

    function createSnowField(count: number) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const baseY = new Float32Array(count);
      const drift = new Float32Array(count);
      const phase = new Float32Array(count);

      for (let index = 0; index < count; index += 1) {
        const offset = index * 3;
        positions[offset] = Math.random() * 2.8 - 1.4;
        positions[offset + 1] = Math.random() * 2.1 - 1.05;
        positions[offset + 2] = Math.random() * 0.35 - 0.18;
        baseY[index] = positions[offset + 1];
        drift[index] = (0.0045 + Math.random() * 0.0045) * aura.effectIntensity;
        phase[index] = Math.random() * Math.PI * 2;
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.024,
        color: new THREE.Color("#f8fafc"),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      scene.add(points);
      cleanupMaterials.add(material);
      particleGroups.push({
        geometry,
        positions,
        baseY,
        drift,
        phase,
        kind: "snow",
        material,
        mesh: points,
      });
    }

    function createFogField(count: number) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const baseY = new Float32Array(count);
      const drift = new Float32Array(count);
      const phase = new Float32Array(count);

      for (let index = 0; index < count; index += 1) {
        const offset = index * 3;
        positions[offset] = Math.random() * 2.6 - 1.3;
        positions[offset + 1] = Math.random() * 0.9 - 0.45;
        positions[offset + 2] = Math.random() * 0.45 - 0.2;
        baseY[index] = positions[offset + 1];
        drift[index] = (0.0014 + Math.random() * 0.001) * aura.effectIntensity;
        phase[index] = Math.random() * Math.PI * 2;
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.12,
        color: new THREE.Color("#cbd5e1"),
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      scene.add(points);
      cleanupMaterials.add(material);
      particleGroups.push({
        geometry,
        positions,
        baseY,
        drift,
        phase,
        kind: "fog",
        material,
        mesh: points,
      });
    }

    function createCloudField(count: number) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const baseY = new Float32Array(count);
      const drift = new Float32Array(count);
      const phase = new Float32Array(count);

      for (let index = 0; index < count; index += 1) {
        const offset = index * 3;
        positions[offset] = Math.random() * 2.7 - 1.35;
        positions[offset + 1] = Math.random() * 0.75 + 0.1;
        positions[offset + 2] = Math.random() * 0.3 - 0.15;
        baseY[index] = positions[offset + 1];
        drift[index] = (0.0012 + Math.random() * 0.0009) * aura.effectIntensity;
        phase[index] = Math.random() * Math.PI * 2;
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.1,
        color: new THREE.Color("#dbeafe"),
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      scene.add(points);
      cleanupMaterials.add(material);
      particleGroups.push({
        geometry,
        positions,
        baseY,
        drift,
        phase,
        kind: "cloud",
        material,
        mesh: points,
      });
    }

    createParticleField(90, 0.018, aura.particleOpacity * 0.9, -0.1);
    createParticleField(60, 0.026, aura.particleOpacity * 0.65, 0.08);

    if (aura.effect === "rain" || aura.effect === "storm") {
      createRainField(aura.effect === "storm" ? 240 : 170);
    } else if (aura.effect === "snow") {
      createSnowField(150);
    } else if (aura.effect === "fog") {
      createFogField(90);
    } else if (aura.effect === "cloud" || aura.effect === "wind") {
      createCloudField(aura.effect === "wind" ? 80 : 54);
    }

    if (aura.effect === "storm") {
      const flashLight = new THREE.PointLight(0xdbeafe, 0, 6, 2);
      flashLight.position.set(0.2, 0.9, 1.1);
      scene.add(flashLight);
      effectLights.push(flashLight);
    }

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
          if (field.kind === "flow") {
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
          } else if (field.kind === "rain") {
            let nextY = field.positions[offset + 1] - field.drift[index];
            let nextX = field.positions[offset] + field.phase[index] * aura.drift;
            if (nextY < -1.12 || nextX > 1.45) {
              nextY = 1.15 + Math.random() * 0.25;
              nextX = Math.random() * 2.9 - 1.45;
            }
            field.positions[offset] = nextX;
            field.positions[offset + 1] = nextY;
          } else if (field.kind === "snow") {
            let nextY = field.positions[offset + 1] - field.drift[index];
            let nextX =
              field.positions[offset] +
              Math.sin(elapsed * 0.9 + field.phase[index]) * 0.0024 * aura.effectIntensity;
            if (nextY < -1.1) {
              nextY = 1.12 + Math.random() * 0.2;
              nextX = Math.random() * 2.8 - 1.4;
            }
            field.positions[offset] = nextX;
            field.positions[offset + 1] = nextY;
          } else if (field.kind === "fog" || field.kind === "cloud") {
            let nextX = field.positions[offset] + field.drift[index];
            if (nextX > 1.38) {
              nextX = -1.38;
              field.baseY[index] =
                field.kind === "cloud"
                  ? Math.random() * 0.75 + 0.1
                  : Math.random() * 0.9 - 0.45;
            }
            field.positions[offset] = nextX;
            field.positions[offset + 1] =
              field.baseY[index] +
              Math.sin(elapsed * 0.3 + field.phase[index]) *
                (field.kind === "cloud" ? 0.03 : 0.05);
          }
        }

        field.geometry.attributes.position.needsUpdate = true;
      }

      if (effectLights.length > 0) {
        const flashPulse = Math.max(0, Math.sin(elapsed * 2.1) - 0.78) * 20;
        for (const light of effectLights) {
          if (light instanceof THREE.PointLight) {
            light.intensity = flashPulse;
          }
        }
        (flashOverlay.material as THREE.MeshBasicMaterial).opacity = Math.min(
          0.18,
          flashPulse / 120,
        );
      } else {
        (flashOverlay.material as THREE.MeshBasicMaterial).opacity = 0;
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
      cleanupMaterials.forEach((material) => material.dispose());
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
    aura.effect,
    aura.effectIntensity,
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
      aura.effect === "rain" || aura.effect === "storm"
        ? `linear-gradient(180deg, ${hexToRgba("#67e8f9", 0.06 * aura.effectIntensity)}, transparent 45%)`
        : aura.effect === "snow"
          ? `linear-gradient(180deg, ${hexToRgba("#e2e8f0", 0.06 * aura.effectIntensity)}, transparent 45%)`
          : aura.effect === "fog"
            ? `radial-gradient(circle at 50% 56%, ${hexToRgba("#cbd5e1", 0.08 * aura.effectIntensity)}, transparent 60%)`
            : aura.effect === "cloud"
              ? `linear-gradient(180deg, ${hexToRgba("#dbeafe", 0.04 * aura.effectIntensity)}, transparent 40%)`
              : "none",
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
