"use client";

import clsx from "clsx";
import { useI18n } from "@/hooks/useI18n";
import { CityDetail } from "@/lib/dashboard-types";
import { getModelView } from "@/lib/model-utils";

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>{text}</div>
  );
}

type ModelMetadata = NonNullable<
  NonNullable<CityDetail["source_forecasts"]>["open_meteo_multi_model"]
>["model_metadata"];

function getModelGroupMeta(
  name: string,
  metadata: ModelMetadata,
  locale: string,
) {
  const meta = metadata?.[name] || {};
  const tier = String(meta.tier || "").toLowerCase();
  const upperName = String(name || "").toUpperCase();

  if (tier.includes("aifs") || upperName.includes("AIFS")) {
    return {
      key: "aifs",
      label: locale === "en-US" ? "AIFS model" : "AIFS 模型",
      order: 1,
      tone: "blue",
    };
  }
  if (
    tier.includes("europe") ||
    upperName.includes("ICON-EU") ||
    upperName.includes("ICON-D2")
  ) {
    return {
      key: "europe",
      label: locale === "en-US" ? "Europe high-resolution" : "欧洲高分辨率",
      order: 2,
      tone: "cyan",
    };
  }
  if (
    tier.includes("north_america") ||
    upperName === "RDPS" ||
    upperName === "HRDPS"
  ) {
    return {
      key: "north-america",
      label:
        locale === "en-US" ? "North America high-resolution" : "北美高分辨率",
      order: 3,
      tone: "amber",
    };
  }
  return {
    key: "global",
    label: locale === "en-US" ? "Global baseline" : "全球基准",
    order: 0,
    tone: "neutral",
  };
}

function formatModelMetaLine(
  name: string,
  metadata: ModelMetadata,
  locale: string,
) {
  const meta = metadata?.[name] || {};
  const provider = String(meta.provider || "").trim();
  const model = String(meta.model || "").trim();
  const horizon = String(meta.horizon || "").trim();
  const resolution = Number(meta.resolution_km);
  const parts = [
    provider,
    model && model !== name ? model : "",
    Number.isFinite(resolution)
      ? `${resolution}${locale === "en-US" ? " km" : " 公里"}`
      : "",
    horizon,
  ].filter(Boolean);
  return parts.join(" · ");
}


export function ModelForecast({
  detail,
  hideTitle = false,
  targetDate,
}: {
  detail: CityDetail;
  hideTitle?: boolean;
  targetDate?: string | null;
}) {
  const { locale, t } = useI18n();
  const view = getModelView(detail, targetDate);
  const modelsMap = { ...view.models };
  const modelMetadata =
    detail.source_forecasts?.open_meteo_multi_model?.model_metadata || {};

  const modelEntries = Object.entries(modelsMap).filter(
    ([, value]) =>
      value !== null && value !== undefined && Number.isFinite(Number(value)),
  );
  const hasSingleModelOnly = modelEntries.length === 1;

  // 如果没有任何数值，给出提示
  if (modelEntries.length === 0) {
    return (
      <section className="models-section">
        {!hideTitle && <h3>{t("section.models")}</h3>}
        <div className="model-bars">
          <EmptyState text={t("section.noModels")} />
        </div>
      </section>
    );
  }

  const numericValues = modelEntries.map(([, value]) => Number(value));
  const comparisonValues =
    view.deb != null ? [...numericValues, Number(view.deb)] : numericValues;
  const minValue = comparisonValues.length
    ? Math.min(...comparisonValues) - 1
    : 0;
  const maxValue = comparisonValues.length
    ? Math.max(...comparisonValues) + 1
    : 1;
  const range = Math.max(maxValue - minValue, 1);
  const sortedEntries = modelEntries.sort(
    (a, b) => Number(b[1] || 0) - Number(a[1] || 0),
  );
  const groupedEntries = sortedEntries
    .reduce(
      (acc, [name, value]) => {
        const group = getModelGroupMeta(name, modelMetadata, locale);
        const existing = acc.find((item) => item.key === group.key);
        const entry = {
          metaLine: formatModelMetaLine(name, modelMetadata, locale),
          name,
          value: Number(value),
        };
        if (existing) {
          existing.entries.push(entry);
        } else {
          acc.push({ ...group, entries: [entry] });
        }
        return acc;
      },
      [] as Array<{
        entries: Array<{ metaLine: string; name: string; value: number }>;
        key: string;
        label: string;
        order: number;
        tone: string;
      }>,
    )
    .sort((a, b) => a.order - b.order);
  const spread =
    numericValues.length >= 2
      ? Math.max(...numericValues) - Math.min(...numericValues)
      : null;
  const metadataSource =
    detail.source_forecasts?.open_meteo_multi_model?.provider === "open-meteo"
      ? "Open-Meteo"
      : null;

  return (
    <section className="models-section">
      {!hideTitle && <h3>{t("section.models")}</h3>}
      <div className="model-bars">
        <div className="model-stack-summary">
          <span>
            {locale === "en-US" ? "Available models" : "可用模型"} ·{" "}
            <strong>{modelEntries.length}</strong>
          </span>
          <span>
            {locale === "en-US" ? "Spread" : "分歧"} ·{" "}
            <strong>
              {spread != null
                ? `${spread.toFixed(1)}${detail.temp_symbol}`
                : "--"}
            </strong>
          </span>
          {metadataSource && (
            <span>
              {locale === "en-US" ? "API" : "接口"} ·{" "}
              <strong>{metadataSource}</strong>
            </span>
          )}
        </div>
        {hasSingleModelOnly && (
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "11px",
              marginBottom: "8px",
            }}
          >
            {locale === "en-US"
              ? "Single-model fallback: waiting for the rest of the model cluster."
              : "当前处于单模型回退，其他模型结果还没回传。"}
          </div>
        )}
        {groupedEntries.map((group) => (
          <div
            key={group.key}
            className={clsx("model-group", `model-group-${group.tone}`)}
          >
            <div className="model-group-heading">
              <span>{group.label}</span>
              <em>{group.entries.length}</em>
            </div>
            {group.entries.map(({ metaLine, name, value }) => {
              const width = ((value - minValue) / range) * 100;
              const debLine =
                view.deb != null
                  ? ((Number(view.deb) - minValue) / range) * 100
                  : null;

              return (
                <div key={name} className="model-row model-row-rich">
                  <div className="model-name" title={metaLine || name}>
                    <strong>{name}</strong>
                    {metaLine && <span>{metaLine}</span>}
                  </div>
                  <div className="model-bar-track">
                    <div
                      className="model-bar-fill"
                      style={{ width: `${width}%` }}
                    />
                    <span className="model-bar-value">
                      {value}
                      {detail.temp_symbol}
                    </span>
                    {debLine != null && (
                      <div
                        className="model-deb-line"
                        style={{ left: `${debLine}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {view.deb != null && (
          <div
            className="model-row"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.06)",
              marginTop: "6px",
              paddingTop: "6px",
            }}
          >
            <div
              className="model-name"
              style={{ color: "var(--accent-cyan)", fontWeight: 700 }}
            >
              DEB
            </div>
            <div className="model-bar-track">
              <div
                className="model-bar-fill deb"
                style={{
                  width: `${((Number(view.deb) - minValue) / range) * 100}%`,
                }}
              />
              <span className="model-bar-value deb">
                {Number(view.deb)}
                {detail.temp_symbol}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
