import type { Locale } from "@/lib/i18n";

function isEnglish(locale: Locale) {
  return locale === "en-US";
}

export function formatTafMarkerType(type: string, locale: Locale = "zh-CN") {
  const normalized = String(type || "").trim().toUpperCase();
  if (isEnglish(locale)) {
    return (
      {
        BASE: "Base regime",
        FM: "Hard shift",
        TEMPO: "Temporary swing",
        BECMG: "Gradual shift",
        PROB30: "30% risk window",
        PROB40: "40% risk window",
        "PROB30 TEMPO": "30% temporary swing",
        "PROB40 TEMPO": "40% temporary swing",
      }[normalized] || normalized
    );
  }
  return (
    {
      BASE: "基础时段",
      FM: "明确切换",
      TEMPO: "临时波动",
      BECMG: "逐步转变",
      PROB30: "30% 风险窗",
      PROB40: "40% 风险窗",
      "PROB30 TEMPO": "30% 临时波动",
      "PROB40 TEMPO": "40% 临时波动",
    }[normalized] || normalized
  );
}
