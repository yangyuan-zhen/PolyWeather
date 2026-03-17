"use client";

import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";

const GUIDE_CARDS = {
  "zh-CN": [
    {
      body: "Dynamic Ensemble Blending 是系统的核心预测层。它不是对 ECMWF、GFS、ICON、GEM、JMA 等模型的简单平均，而是结合近期样本表现、当前实况与城市偏置后得到的动态加权结果。",
      title: "DEB 动态融合预测",
    },
    {
      body: "右侧的结算概率分布基于 DEB 预测值与多模型离散度动态计算。μ 代表当前分布中心，会随着模型、实况和时间变化而变化，不是固定结算值。",
      title: "结算概率引擎",
    },
    {
      body: "结算源按城市市场定义：米兰(LIMC)、华沙(EPWA)、马德里(LEMD)使用机场 METAR；香港市场使用香港天文台(HKO)；台北市场使用交通部中央气象署(CWA)。系统仍会保留 METAR/MGM 作为临近结构参考，并区分观测时间与接收时间。",
      title: "结算点与主观测源",
    },
    {
      body: "Ankara 不走通用城市逻辑。结算主站以 LTAC / Esenboğa 为准，周边领先信号优先参考 Turkish MGM 站网，其中 Ankara (Bölge/Center) 是重点监控站，不用 Etimesgut 代替。",
      title: "Ankara 专属增强",
    },
    {
      body: "点击多日预报后的模态框，主要用于分析下一个交易日。6-48 小时趋势以 weather.gov 和 Open-Meteo 为主；0-2 小时临近判断优先看 METAR 与周边站。",
      title: "未来日期分析",
    },
    {
      body: "历史准确率对账只统计已结算样本。网页端采用近 15 天滚动视图，不把当天尚未结算的样本算入胜率和 MAE。",
      title: "历史对账规则",
    },
  ],
  "en-US": [
    {
      body: "Dynamic Ensemble Blending (DEB) is the core prediction layer. It is not a simple average across ECMWF/GFS/ICON/GEM/JMA, but a dynamically weighted blend adjusted by recent model performance, current observations, and city bias.",
      title: "DEB Dynamic Fusion",
    },
    {
      body: "Settlement probability distribution is dynamically computed from DEB forecast and model spread. μ is the current distribution center and shifts with model updates, observations, and time.",
      title: "Settlement Probability Engine",
    },
    {
      body: "Settlement source follows market rule by city: Milan (LIMC), Warsaw (EPWA), and Madrid (LEMD) settle on airport METAR, Hong Kong settles on HKO, and Taipei settles on CWA. METAR/MGM are still kept for intraday structure tracking with observation time vs receipt time separated.",
      title: "Settlement Source Logic",
    },
    {
      body: "Ankara does not follow the generic city path. LTAC / Esenboğa is the settlement station, with Turkish MGM network for leading signals. Ankara (Bölge/Center) is a key station and is not replaced by Etimesgut.",
      title: "Ankara-specific Enhancement",
    },
    {
      body: "The multi-day modal focuses on next-session analysis. 6-48h trend mainly relies on weather.gov and Open-Meteo; 0-2h nowcast prioritizes METAR and nearby stations.",
      title: "Future-date Analysis",
    },
    {
      body: "History reconciliation only uses settled samples. The web dashboard uses a rolling 15-day window and excludes same-day unsettled samples from hit-rate and MAE.",
      title: "History Rules",
    },
  ],
} as const;

export function GuideModal() {
  const store = useDashboardStore();
  const { locale, t } = useI18n();

  if (!store.isGuideOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          store.closeGuide();
        }
      }}
    >
      <div className="modal-content large">
        <div className="modal-header">
          <h2 id="guide-modal-title">{t("guide.title")}</h2>
          <button
            type="button"
            className="modal-close"
            aria-label={t("guide.closeAria")}
            onClick={store.closeGuide}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="guide-grid">
            {GUIDE_CARDS[locale].map((card) => (
              <div key={card.title} className="guide-card">
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </div>
            ))}
          </div>
          <div className="guide-footer">{t("guide.footer")}</div>
        </div>
      </div>
    </div>
  );
}
