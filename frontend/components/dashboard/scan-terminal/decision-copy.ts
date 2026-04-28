export type DecisionCopyLocale = "zh-CN" | "en-US";

function isEnglishLocale(localeOrIsEn: DecisionCopyLocale | string | boolean) {
  return localeOrIsEn === true || localeOrIsEn === "en-US";
}

export function getAiReadCopy({
  isEn,
  isHkoObservation,
}: {
  isEn: boolean;
  isHkoObservation: boolean;
}) {
  return {
    complete: isEn
      ? isHkoObservation
        ? "AI HKO observation read is complete."
        : "AI airport bulletin read is complete."
      : isHkoObservation
        ? "AI 香港天文台观测解读已完成"
        : "AI 机场报文解读已完成",
    inProgress: isEn
      ? isHkoObservation
        ? "Fast read is ready; AI is adding HKO observation details..."
        : "Fast read is ready; AI is adding airport bulletin details..."
      : isHkoObservation
        ? "快速判断已完成，AI 正在补充香港天文台观测细节…"
        : "快速判断已完成，AI 正在补充机场报文细节…",
    ruleEvidence: isEn
      ? "AI read did not return completely; rule evidence is being used."
      : "AI 解读未完整返回，当前使用规则证据",
  };
}

export function getCityLoadingCopy({
  isEn,
  isHkoObservation,
}: {
  isEn: boolean;
  isHkoObservation: boolean;
}) {
  return {
    description: isEn
      ? isHkoObservation
        ? "Hydrating today’s model stack, HKO observation context and market layer."
        : "Hydrating today’s model stack, METAR context and market layer."
      : isHkoObservation
        ? "正在补全今日模型、香港天文台观测和市场价格层。"
        : "正在补全今日模型、机场报文和市场价格层。",
    title: isEn ? "Loading city decision data" : "正在加载城市决策数据",
  };
}

export function getMobileDecisionCopy(localeOrIsEn: DecisionCopyLocale | string | boolean) {
  const isEn = isEnglishLocale(localeOrIsEn);
  return {
    aiDetails: isEn ? "AI read" : "AI 解读",
    chart: isEn ? "Light trend chart" : "轻量走势图",
    currentTemp: isEn ? "Observed" : "当前温度",
    expectedHigh: isEn ? "Expected high" : "预测高点",
    marketPrice: isEn ? "Market price" : "市场价格",
    modelEvidence: isEn ? "Model evidence" : "模型证据",
    peakWindow: isEn ? "Peak window" : "峰值窗口",
    refresh: isEn ? "Refresh" : "刷新",
    remove: isEn ? "Remove" : "移除",
  };
}
