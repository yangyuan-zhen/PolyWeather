"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { CityListItem } from "@/lib/dashboard-types";

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
  const { t } = useI18n();
  const selectedCity = store.selectedCity;
  const riskOrder = { high: 0, medium: 1, low: 2, other: 3 };
  const [expandedGroups, setExpandedGroups] = useState<
    Record<RiskGroupKey, boolean>
  >(DEFAULT_EXPANDED_GROUPS);

  const sortedCities = useMemo(
    () =>
      [...store.cities].sort((a, b) => {
        const aGroup = toRiskGroup(a.risk_level);
        const bGroup = toRiskGroup(b.risk_level);
        return (
          (riskOrder[aGroup] ?? 3) -
            (riskOrder[bGroup] ?? 3) ||
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
      groups[toRiskGroup(city.risk_level)].push(city);
    });
    return groups;
  }, [sortedCities]);

  useEffect(() => {
    if (!selectedCity) return;
    const selected = store.cities.find((city) => city.name === selectedCity);
    if (!selected) return;
    const groupKey = toRiskGroup(selected.risk_level);
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
                <span className="city-group-title">{group.label}</span>
                <span className="city-group-meta">
                  <span className="city-group-count">{citiesInGroup.length}</span>
                  <span className={clsx("city-group-arrow", expanded && "expanded")}>
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
                        <span className={clsx("risk-dot", city.risk_level)} />
                        <span className="city-name-text">{city.display_name}</span>
                        <span
                          className={clsx(
                            "city-temp",
                            snapshot?.current?.temp != null && "loaded",
                          )}
                        >
                          {snapshot?.current?.temp != null
                            ? `${snapshot.current.temp}${snapshot.temp_symbol || "°C"}`
                            : t("common.na")}
                        </span>
                      </div>

                      <div className="city-item-info">
                        <span className="city-local-time">
                          {snapshot?.local_time ? `🕒 ${snapshot.local_time}` : ""}
                        </span>
                        <span className="city-max-info">
                          {detail?.current?.max_temp_time
                            ? t("sidebar.peakAt", { time: detail.current.max_temp_time })
                            : ""}
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
