"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Clock } from "lucide-react";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { CityListItem, DeviationMonitor } from "@/lib/dashboard-types";

type RiskGroupKey = "high" | "medium" | "low" | "other";

const GROUP_STATE_STORAGE_KEY = "polyWeather_sidebar_groups_v1";
const DEFAULT_EXPANDED_GROUPS: Record<RiskGroupKey, boolean> = {
  high: true,
  medium: true,
  low: false,
  other: false,
};

function toRiskGroup(level?: string): RiskGroupKey {
  if (level === "high" || level === "medium" || level === "low") return level;
  return "other";
}

function toPerformanceGroup(city: CityListItem): RiskGroupKey {
  return toRiskGroup(city.deb_recent_tier);
}

function normalizeExpandedGroups(
  value: unknown,
): Record<RiskGroupKey, boolean> {
  if (!value || typeof value !== "object") {
    return DEFAULT_EXPANDED_GROUPS;
  }
  const candidate = value as Partial<Record<RiskGroupKey, unknown>>;
  return {
    high:
      typeof candidate.high === "boolean"
        ? candidate.high
        : DEFAULT_EXPANDED_GROUPS.high,
    medium:
      typeof candidate.medium === "boolean"
        ? candidate.medium
        : DEFAULT_EXPANDED_GROUPS.medium,
    low:
      typeof candidate.low === "boolean"
        ? candidate.low
        : DEFAULT_EXPANDED_GROUPS.low,
    other:
      typeof candidate.other === "boolean"
        ? candidate.other
        : DEFAULT_EXPANDED_GROUPS.other,
  };
}

export function CitySidebar() {
  const store = useDashboardStore();
  const { locale, t } = useI18n();
  const selectedCity = store.selectedCity;
  const riskOrder = { high: 0, medium: 1, low: 2, other: 3 };
  const [expandedGroups, setExpandedGroups] = useState<
    Record<RiskGroupKey, boolean>
  >(DEFAULT_EXPANDED_GROUPS);

  const sortedCities = useMemo(
    () =>
      [...store.cities].sort((a, b) => {
        const aGroup = toPerformanceGroup(a);
        const bGroup = toPerformanceGroup(b);
        const aHitRate = Number(a.deb_recent_hit_rate ?? -1);
        const bHitRate = Number(b.deb_recent_hit_rate ?? -1);
        const aSamples = Number(a.deb_recent_sample_count ?? 0);
        const bSamples = Number(b.deb_recent_sample_count ?? 0);
        return (
          (riskOrder[aGroup] ?? 3) - (riskOrder[bGroup] ?? 3) ||
          bHitRate - aHitRate ||
          bSamples - aSamples ||
          a.display_name.localeCompare(b.display_name)
        );
      }),
    [store.cities],
  );

  const groupedCities = useMemo(() => {
    const groups: Record<RiskGroupKey, CityListItem[]> = {
      high: [],
      medium: [],
      low: [],
      other: [],
    };
    sortedCities.forEach((city) => {
      groups[toPerformanceGroup(city)].push(city);
    });
    return groups;
  }, [sortedCities]);

  useEffect(() => {
    if (!selectedCity) return;
    const selected = store.cities.find((city) => city.name === selectedCity);
    if (!selected) return;
    const groupKey = toPerformanceGroup(selected);
    setExpandedGroups((current) =>
      current[groupKey] ? current : { ...current, [groupKey]: true },
    );
  }, [selectedCity, store.cities]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(GROUP_STATE_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      setExpandedGroups(normalizeExpandedGroups(parsed));
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        GROUP_STATE_STORAGE_KEY,
        JSON.stringify(expandedGroups),
      );
    } catch {}
  }, [expandedGroups]);

  const formatDeviationText = (monitor?: DeviationMonitor | null) => {
    if (!monitor?.available) return "";
    const label = locale === "en-US" ? monitor.label_en : monitor.label_zh;
    const trendLabel =
      locale === "en-US" ? monitor.trend_label_en : monitor.trend_label_zh;
    if (!label) return "";
    return trendLabel ? `${label} · ${trendLabel}` : label;
  };

  const groupMeta: Array<{ key: RiskGroupKey; label: string }> = [
    { key: "high", label: t("sidebar.group.high") },
    { key: "medium", label: t("sidebar.group.medium") },
    { key: "low", label: t("sidebar.group.low") },
    { key: "other", label: t("sidebar.group.other") },
  ];

  return (
    <nav className="city-list">
      <div className="city-list-header">
        <span>{t("sidebar.title")}</span>
        <span className="city-count">{store.cities.length}</span>
      </div>

      <div className="city-list-items">
        {groupMeta.map((group) => {
          const citiesInGroup = groupedCities[group.key];
          if (!citiesInGroup.length) return null;
          const expanded = expandedGroups[group.key];

          return (
            <section
              key={group.key}
              className={clsx("city-group", !expanded && "collapsed")}
            >
              <button
                type="button"
                className="city-group-header"
                aria-expanded={expanded}
                onClick={() =>
                  setExpandedGroups((current) => ({
                    ...current,
                    [group.key]: !current[group.key],
                  }))
                }
              >
                <span className="city-group-title">
                  <span
                    className={clsx("city-group-indicator", group.key)}
                    aria-hidden="true"
                  />
                  {group.label}
                </span>
                <span className="city-group-meta">
                  <span className="city-group-count">
                    {citiesInGroup.length}
                  </span>
                  <span
                    className={clsx("city-group-arrow", expanded && "expanded")}
                  >
                    ▾
                  </span>
                </span>
              </button>

              <div className="city-group-items">
                {citiesInGroup.map((city) => {
                  const detail = store.cityDetailsByName[city.name];
                  const summary = store.citySummariesByName[city.name];
                  const snapshot = detail || summary;
                  const isActive = store.selectedCity === city.name;
                  const tempSymbol = snapshot?.temp_symbol || "°C";
                  const currentTempText =
                    snapshot?.current?.temp != null
                      ? t("sidebar.currentTemp", {
                          temp: `${snapshot.current.temp}${tempSymbol}`,
                        })
                      : t("common.na");
                  const deviationText = formatDeviationText(
                    snapshot?.deviation_monitor,
                  );
                  const peakTempText =
                    detail?.current?.max_so_far != null &&
                    detail.current.max_temp_time
                      ? t("sidebar.peakTempAt", {
                          temp: `${detail.current.max_so_far}${tempSymbol}`,
                          time: detail.current.max_temp_time,
                        })
                      : detail?.current?.max_temp_time
                        ? t("sidebar.peakAt", {
                            time: detail.current.max_temp_time,
                          })
                        : "";
                  const deviationDirection =
                    snapshot?.deviation_monitor?.direction || "normal";
                  const deviationSeverity =
                    snapshot?.deviation_monitor?.severity || "normal";
                  const secondaryText = deviationText || peakTempText;
                  const performanceTier = toPerformanceGroup(city);

                  return (
                    <button
                      key={city.name}
                      type="button"
                      className={clsx("city-item", isActive && "active")}
                      onClick={() =>
                        startTransition(() => {
                          void store.selectCity(city.name);
                        })
                      }
                    >
                      <div className="city-item-main">
                        <span className={clsx("risk-dot", performanceTier)} />
                        <span className="city-name-text">
                          {city.display_name}
                        </span>
                        <span
                          className={clsx(
                            "city-temp",
                            snapshot?.current?.temp != null && "loaded",
                          )}
                        >
                          {currentTempText}
                        </span>
                      </div>

                      <div className="city-item-info">
                        <span className="city-local-time">
                          {snapshot?.local_time ? (
                            <>
                              <Clock
                                size={10}
                                strokeWidth={2}
                                className="city-clock-icon"
                              />
                              {snapshot.local_time}
                            </>
                          ) : (
                            ""
                          )}
                        </span>
                        <span
                          className={clsx(
                            "city-max-info",
                            deviationText && "city-deviation-info",
                            deviationText &&
                              `city-deviation-${deviationDirection}`,
                            deviationText &&
                              deviationSeverity === "strong" &&
                              "strong",
                          )}
                        >
                          {secondaryText}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </nav>
  );
}
