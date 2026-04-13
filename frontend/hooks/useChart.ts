"use client";

import { useEffect, useRef } from "react";
import type { Chart as ChartInstance, ChartConfiguration, ChartType } from "chart.js";

let chartModulePromise: Promise<typeof import("chart.js/auto")> | null = null;

export function preloadChartJs() {
  if (!chartModulePromise) {
    chartModulePromise = import("chart.js/auto");
  }
  return chartModulePromise;
}

export function useChart<TType extends ChartType>(
  createConfig: () => ChartConfiguration<TType>,
  dependencies: React.DependencyList,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartInstance<TType> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;

    const setupChart = async () => {
      const { Chart } = await preloadChartJs();
      if (disposed) return;

      const config = createConfig();
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }

      chartRef.current = new Chart(canvas, config);
    };

    void setupChart();
    return () => {
      disposed = true;
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, dependencies);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  return canvasRef;
}
