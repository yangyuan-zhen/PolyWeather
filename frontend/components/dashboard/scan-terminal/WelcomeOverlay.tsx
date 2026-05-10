"use client";

import { useEffect, useState } from "react";
import { MapPin, FileText, Crown } from "lucide-react";

const STORAGE_KEY = "polyweather_welcome_seen";

type Props = {
  locale: string;
  onDismiss: () => void;
};

const steps = [
  {
    icon: MapPin,
    titleEn: "Pick a city on the map",
    titleZh: "从地图选城市",
    descEn: "Click any colored bubble to view real-time weather and forecasts.",
    descZh: "点击地图上的彩色气泡，查看实时天气和预报。",
  },
  {
    icon: FileText,
    titleEn: "Read the city briefing",
    titleZh: "查看城市简报",
    descEn: "The right panel shows current temperature, DEB forecast, and detailed metrics.",
    descZh: "右侧面板展示当前温度、DEB 预报和各项指标。",
  },
  {
    icon: Crown,
    titleEn: "Unlock Pro for deep analysis",
    titleZh: "解锁 Pro 深入分析",
    descEn: "Pro unlocks AI-powered METAR reads, model evidence, market layer, and intraday analysis.",
    descZh: "Pro 解锁 AI 机场报文解读、模型证据、市场层、日内分析。",
  },
];

export function WelcomeOverlay({ locale, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const isEn = locale === "en-US";

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
    onDismiss();
  };

  const handleNext = () => {
    if (isLast) {
      handleDismiss();
    } else {
      setStep(step + 1);
    }
  };

  return (
    <div
      className="scan-welcome-overlay"
      role="dialog"
      aria-label={isEn ? "Welcome guide" : "新手指引"}
      onClick={handleDismiss}
    >
      <div
        className="scan-welcome-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="scan-welcome-steps">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`scan-welcome-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
            />
          ))}
        </div>

        <div className="scan-welcome-icon-wrap">
          <current.icon size={32} className="scan-welcome-icon" />
        </div>

        <h2 className="scan-welcome-title">
          {isEn ? current.titleEn : current.titleZh}
        </h2>
        <p className="scan-welcome-desc">
          {isEn ? current.descEn : current.descZh}
        </p>

        <div className="scan-welcome-actions">
          <button
            type="button"
            className="scan-welcome-skip"
            onClick={handleDismiss}
          >
            {isEn ? "Skip" : "跳过"}
          </button>
          <button
            type="button"
            className="scan-primary-button"
            onClick={handleNext}
          >
            {isLast
              ? isEn ? "Got it" : "知道了"
              : isEn ? "Next" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}
