"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
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
  if (tone === "cyan") return "#22d3ee";
  if (tone === "blue") return "#60a5fa";
  if (tone === "amber") return "#f59e0b";
  return "#94a3b8";
}

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

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 2.8, 7.2);
    camera.lookAt(0, 1.2, 0);

    const ambient = new THREE.AmbientLight(0xbfe8ff, 1.25);
    const keyLight = new THREE.PointLight(0x67e8f9, 22, 18, 2);
    keyLight.position.set(-3.8, 5.6, 4.8);
    const warmLight = new THREE.PointLight(0xf59e0b, 12, 16, 2);
    warmLight.position.set(4.2, 2.8, 4);
    scene.add(ambient, keyLight, warmLight);

    const stage = new THREE.Group();
    scene.add(stage);

    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(3.3, 3.8, 0.12, 48),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(score >= 0 ? "#10263b" : "#2c1d12"),
        emissive: new THREE.Color(score >= 0 ? "#0e7490" : "#b45309"),
        emissiveIntensity: 0.18 + clamp(Math.abs(score) / 8, 0, 0.24),
        metalness: 0.2,
        roughness: 0.78,
      }),
    );
    floor.position.y = -0.12;
    stage.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.8, 0.03, 18, 100),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(score >= 0 ? "#22d3ee" : "#f59e0b"),
        transparent: true,
        opacity: 0.5,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    stage.add(ring);

    const barGeometry = new THREE.BoxGeometry(0.8, 1, 0.8);
    const capGeometry = new THREE.SphereGeometry(0.16, 16, 16);
    const bars: Array<{
      mesh: THREE.Mesh;
      cap: THREE.Mesh;
      glow: THREE.Mesh;
      baseY: number;
      targetHeight: number;
    }> = [];

    const xPositions = [-1.8, -0.6, 0.6, 1.8];
    metrics.slice(0, 4).forEach((metric, index) => {
      const height = 0.5 + ((metric.fill ?? 20) / 100) * 2.8;
      const color = new THREE.Color(getToneColor(metric.tone));
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.22,
        metalness: 0.14,
        roughness: 0.38,
      });
      const mesh = new THREE.Mesh(barGeometry, material);
      mesh.position.set(xPositions[index] || 0, height / 2, 0);
      mesh.scale.y = height;
      stage.add(mesh);

      const cap = new THREE.Mesh(
        capGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
        }),
      );
      cap.position.set(mesh.position.x, height + 0.2, 0);
      stage.add(cap);

      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.46, 0.58, 0.08, 32),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.22,
        }),
      );
      glow.position.set(mesh.position.x, 0.06, 0);
      stage.add(glow);

      bars.push({ mesh, cap, glow, baseY: cap.position.y, targetHeight: height });
    });

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    resize();
    host.appendChild(renderer.domElement);

    const clock = new THREE.Clock();
    let frameId = 0;

    const renderFrame = () => {
      frameId = window.requestAnimationFrame(renderFrame);
      const elapsed = clock.getElapsedTime();
      stage.rotation.y = Math.sin(elapsed * 0.35) * 0.16;
      ring.material.opacity = 0.38 + Math.sin(elapsed * 0.8) * 0.08;

      bars.forEach((bar, index) => {
        const pulse = prefersReducedMotion
          ? 0
          : Math.sin(elapsed * 1.5 + index * 0.8) * 0.08;
        bar.cap.position.y = bar.baseY + pulse;
        bar.glow.scale.x = 1 + Math.sin(elapsed * 1.2 + index) * 0.06;
        bar.glow.scale.z = 1 + Math.sin(elapsed * 1.2 + index) * 0.06;
      });

      renderer.render(scene, camera);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    frameId = window.requestAnimationFrame(renderFrame);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
      stage.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((material) => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [metrics, prefersReducedMotion, score]);

  return (
    <div className="intraday-scene-shell">
      <div ref={containerRef} className="intraday-scene-frame" aria-hidden="true" />
      <div className="intraday-scene-legend">
        {metrics.slice(0, 4).map((metric) => (
          <div key={metric.key} className="intraday-scene-chip">
            <span
              className="intraday-scene-chip-dot"
              style={{ backgroundColor: getToneColor(metric.tone) }}
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
