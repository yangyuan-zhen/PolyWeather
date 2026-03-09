"use client";

import { useEffect, useRef } from "react";
import { Chart, ChartConfiguration, ChartType } from "chart.js/auto";

export function useChart<TType extends ChartType>(
  createConfig: () => ChartConfiguration<TType>,
  dependencies: React.DependencyList,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart<TType> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const config = createConfig();
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new Chart(canvas, config);
    return () => {
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
