"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Activity, ArrowRight, Check, LineChart, Sigma, X } from "lucide-react";

// Bump the key to re-show the tour for existing users after a redesign.
const ONBOARDING_STORAGE_KEY = "polyweather_terminal_onboarding_v1";

type Step = {
  key: string;
  Icon: typeof Activity;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
};

const STEPS: Step[] = [
  {
    key: "live",
    Icon: Activity,
    titleZh: "先看实况锚点",
    titleEn: "Start with live evidence",
    bodyZh:
      "青绿色粗线是结算源实况（官方站优先），先确认温度已经兑现到哪，再谈预测。",
    bodyEn:
      "The teal line is the settlement-source observation (official station first). See what is already realized before looking at forecasts.",
  },
  {
    key: "deb",
    Icon: LineChart,
    titleZh: "再看 DEB 预测中枢",
    titleEn: "Then the DEB center",
    bodyZh:
      "橙色 DEB Forecast 融合多模型与日内修正，是判断后续升温 / 降温空间的主路径。",
    bodyEn:
      "The orange DEB Forecast blends models with intraday correction — the main path for the remaining move.",
  },
  {
    key: "probability",
    Icon: Sigma,
    titleZh: "最后看市场概率",
    titleEn: "Finally, market odds",
    bodyZh:
      "图表底部可直达 Polymarket 合约；概率面板对比模型概率与市场定价的差。",
    bodyEn:
      "Jump to the Polymarket contract from the chart footer; the probability panel shows model vs market gap.",
  },
];

export function TerminalOnboardingTour({
  isEn,
  hasData,
}: {
  isEn: boolean;
  hasData: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!hasData) return;
    let dismissed = false;
    try {
      dismissed = Boolean(window.localStorage.getItem(ONBOARDING_STORAGE_KEY));
    } catch {}
    if (dismissed) return;
    const timer = window.setTimeout(() => setVisible(true), 700);
    return () => window.clearTimeout(timer);
  }, [hasData]);

  const finish = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, new Date().toISOString());
    } catch {}
  }, []);

  if (!visible) return null;
  const step = STEPS[stepIndex];
  const isLast = stepIndex >= STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/30 p-4 pb-10 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? "Terminal guide" : "终端使用引导"}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <step.Icon size={20} />
          </div>
          <button
            type="button"
            onClick={finish}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label={isEn ? "Close guide" : "关闭引导"}
          >
            <X size={18} />
          </button>
        </div>

        <h3 className="text-base font-black text-slate-900">
          {isEn ? step.titleEn : step.titleZh}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {isEn ? step.bodyEn : step.bodyZh}
        </p>

        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {STEPS.map((item, index) => (
              <span
                key={item.key}
                className={clsx(
                  "h-1.5 rounded-full transition-all",
                  index === stepIndex
                    ? "w-6 bg-blue-600"
                    : index < stepIndex
                      ? "w-1.5 bg-blue-300"
                      : "w-1.5 bg-slate-200",
                )}
                aria-hidden="true"
              />
            ))}
            <span className="ml-2 text-xs font-medium text-slate-400">
              {stepIndex + 1}/{STEPS.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isLast ? (
              <button
                type="button"
                onClick={finish}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-600"
              >
                {isEn ? "Skip" : "跳过"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={isLast ? finish : () => setStepIndex((prev) => prev + 1)}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700"
            >
              {isLast ? (
                <>
                  <Check size={16} />
                  {isEn ? "Got it" : "开始使用"}
                </>
              ) : (
                <>
                  {isEn ? "Next" : "下一步"}
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
