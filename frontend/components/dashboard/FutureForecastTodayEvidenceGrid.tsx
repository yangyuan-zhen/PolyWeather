"use client";

import clsx from "clsx";
import {
  formatSignalDirection,
  formatSignalStrength,
  localizedText,
  signalTone,
} from "./FutureForecastModal.utils";

type MeteorologySignal = {
  direction?: string | null;
  label?: string | null;
  label_en?: string | null;
  strength?: string | null;
  summary?: string | null;
  summary_en?: string | null;
};

export function FutureForecastTodayEvidenceGrid({
  airportMetarAnchor,
  confirmationRules,
  invalidationRules,
  locale,
  meteorologySignals,
  modelSummary,
}: {
  airportMetarAnchor: boolean;
  confirmationRules: string[];
  invalidationRules: string[];
  locale: string;
  meteorologySignals: MeteorologySignal[];
  modelSummary: string;
}) {
  const fallbackInvalidationRule =
    locale === "en-US"
      ? "If observations stop tracking the expected curve, wait for the next refresh."
      : "若实测不再贴近预期曲线，等待下一次刷新确认。";
  const fallbackConfirmationRule =
    locale === "en-US"
      ? airportMetarAnchor
        ? "Keep watching the next anchor METAR report."
        : "Keep watching the next official anchor observation."
      : airportMetarAnchor
        ? "继续观察下一次锚点 METAR 报文。"
        : "继续观察下一次官方锚点观测。";

  return (
    <div className="future-v2-meteorology-grid">
      <section className="future-modal-section future-v2-evidence-panel">
        <div className="modal-section-heading">
          <div className="modal-section-kicker">
            {locale === "en-US" ? "Evidence chain" : "气象证据链"}
          </div>
          <h3>{locale === "en-US" ? "Signal Contributions" : "信号贡献"}</h3>
        </div>
        <div className="future-v2-evidence-list">
          {meteorologySignals.length > 0 ? (
            meteorologySignals.map((signal, index) => (
              <div
                key={`${signal.label || "signal"}-${index}`}
                className={clsx("future-v2-evidence-row", signalTone(signal))}
              >
                <div className="future-v2-evidence-head">
                  <strong>
                    {localizedText(locale, signal.label, signal.label_en) || "--"}
                  </strong>
                  <span>
                    {formatSignalDirection(signal.direction, locale)} ·{" "}
                    {formatSignalStrength(signal.strength, locale)}
                  </span>
                </div>
                <p>
                  {localizedText(locale, signal.summary, signal.summary_en) ||
                    "--"}
                </p>
              </div>
            ))
          ) : (
            <div className="future-text-block">
              {locale === "en-US"
                ? "Meteorology signals are still loading."
                : "气象信号仍在加载。"}
            </div>
          )}
        </div>
      </section>

      <section className="future-modal-section future-v2-rule-panel">
        <div className="modal-section-heading">
          <div className="modal-section-kicker">
            {locale === "en-US" ? "Failure modes" : "失效条件"}
          </div>
          <h3>
            {locale === "en-US" ? "What Downgrades the Read" : "什么会让判断降级"}
          </h3>
        </div>
        <ul className="future-v2-rule-list">
          {(invalidationRules.length > 0
            ? invalidationRules
            : [fallbackInvalidationRule]
          ).map((rule, index) => (
            <li key={`${rule}-${index}`}>{rule}</li>
          ))}
        </ul>
      </section>

      <section className="future-modal-section future-v2-rule-panel">
        <div className="modal-section-heading">
          <div className="modal-section-kicker">
            {locale === "en-US" ? "Confirmation" : "确认条件"}
          </div>
          <h3>
            {locale === "en-US" ? "What Confirms the Path" : "什么会确认主路径"}
          </h3>
        </div>
        <ul className="future-v2-rule-list">
          {(confirmationRules.length > 0
            ? confirmationRules
            : [fallbackConfirmationRule]
          ).map((rule, index) => (
            <li key={`${rule}-${index}`}>{rule}</li>
          ))}
        </ul>
        <div className="future-v2-model-note">{modelSummary}</div>
      </section>
    </div>
  );
}
