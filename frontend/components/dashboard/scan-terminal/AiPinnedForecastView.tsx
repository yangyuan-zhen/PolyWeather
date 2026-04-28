"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiPinnedCityCard } from "@/components/dashboard/scan-terminal/AiPinnedCityCard";
import { findDetailForCity } from "@/components/dashboard/scan-terminal/city-detail-utils";
import { findRowForCity, normalizeCityKey } from "@/components/dashboard/scan-terminal/decision-utils";
import type { AiPinnedCity } from "@/components/dashboard/scan-terminal/types";
import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";

export function AiPinnedForecastView({
  items,
  rows,
  detailsByName,
  locale,
  onRefreshCityDetail,
  onRemoveCity,
}: {
  items: AiPinnedCity[];
  rows: ScanOpportunityRow[];
  detailsByName: Record<string, CityDetail>;
  locale: string;
  onRefreshCityDetail: (cityName: string) => Promise<void>;
  onRemoveCity: (cityName: string) => void;
}) {
  const isEn = locale === "en-US";
  const [collapsedCities, setCollapsedCities] = useState<Set<string>>(
    () => new Set(),
  );
  const [removingCities, setRemovingCities] = useState<Set<string>>(
    () => new Set(),
  );
  const knownCityKeysRef = useRef<Set<string>>(new Set());
  const removeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const activeKeys = new Set(
      items.map((item) => normalizeCityKey(item.cityName) || item.cityName),
    );
    setCollapsedCities((current) => {
      const next = new Set<string>();
      let changed = false;
      current.forEach((key) => {
        if (activeKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      items.forEach((item) => {
        const stableKey = normalizeCityKey(item.cityName) || item.cityName;
        if (!knownCityKeysRef.current.has(stableKey)) {
          changed = true;
        }
      });
      return changed ? next : current;
    });
    knownCityKeysRef.current = activeKeys;
  }, [items]);

  useEffect(() => {
    return () => {
      removeTimersRef.current.forEach((timer) => clearTimeout(timer));
      removeTimersRef.current.clear();
    };
  }, []);

  const removeCityWithMotion = useCallback(
    (item: AiPinnedCity, stableKey: string) => {
      if (removeTimersRef.current.has(stableKey)) return;
      setRemovingCities((current) => {
        const next = new Set(current);
        next.add(stableKey);
        return next;
      });
      const timer = setTimeout(() => {
        onRemoveCity(item.cityName);
        setRemovingCities((current) => {
          const next = new Set(current);
          next.delete(stableKey);
          return next;
        });
        removeTimersRef.current.delete(stableKey);
      }, 260);
      removeTimersRef.current.set(stableKey, timer);
    },
    [onRemoveCity],
  );

  if (!items.length) {
    return (
      <div className="scan-ai-workspace empty">
        <div className="scan-empty-state">
          <div className="scan-empty-title">
            {isEn ? "Click a city on the map" : "从分布视图点击城市"}
          </div>
          <div className="scan-empty-copy">
            {isEn
              ? "Selected cities will appear here as deep analysis blocks."
              : "被点击的城市会加入深度分析页，并保留为城市分析区块。"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-ai-workspace">
      <div className="scan-ai-workspace-head">
        <div>
          <span>{isEn ? "Selected city workspace" : "城市分析工作区"}</span>
          <strong>
            {isEn
              ? `${items.length} cities under deep analysis`
              : `${items.length} 个城市正在深度分析`}
          </strong>
        </div>
        <p>
          {isEn
            ? "Map clicks add cities here. City analysis stays here until you remove it."
            : "地图点击会把城市加入这里；城市分析会保留，直到你手动移除。"}
        </p>
      </div>
      <div className="scan-ai-city-stack">
        {items.map((item) => {
          const detail = findDetailForCity(detailsByName, item.cityName);
          const row = findRowForCity(rows, item.cityName);
          const key = normalizeCityKey(item.cityName);
          const stableKey = key || item.cityName;
          const isKnownCity = knownCityKeysRef.current.has(stableKey);
          return (
            <AiPinnedCityCard
              key={stableKey}
              item={item}
              detail={detail}
              row={row}
              locale={locale}
              collapsed={!isKnownCity || collapsedCities.has(stableKey)}
              removing={removingCities.has(stableKey)}
              onRefreshCityDetail={onRefreshCityDetail}
              onRemove={() => removeCityWithMotion(item, stableKey)}
              onToggleCollapsed={() => {
                setCollapsedCities((current) => {
                  const next = new Set(current);
                  if (next.has(stableKey)) {
                    next.delete(stableKey);
                  } else {
                    next.add(stableKey);
                  }
                  return next;
                });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
