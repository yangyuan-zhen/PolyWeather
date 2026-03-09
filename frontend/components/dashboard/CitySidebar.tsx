"use client";

import clsx from "clsx";
import { useDashboardStore } from "@/hooks/useDashboardStore";

export function CitySidebar() {
  const store = useDashboardStore();
  const sortedCities = [...store.cities].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (
      (order[a.risk_level as keyof typeof order] ?? 3) -
      (order[b.risk_level as keyof typeof order] ?? 3)
    );
  });

  return (
    <nav className="city-list">
      <div className="city-list-header">
        <span>监控城市</span>
        <span className="city-count">{store.cities.length}</span>
      </div>

      <div className="city-list-items">
        {sortedCities.map((city) => {
          const detail = store.cityDetailsByName[city.name];
          const summary = store.citySummariesByName[city.name];
          const snapshot = detail || summary;
          const isActive = store.selectedCity === city.name;

          return (
            <button
              key={city.name}
              type="button"
              className={clsx("city-item", isActive && "active")}
              onClick={() => void store.selectCity(city.name)}
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
                    : "--"}
                </span>
              </div>

              <div className="city-item-info">
                <span className="city-local-time">
                  {snapshot?.local_time ? `🕐 ${snapshot.local_time}` : ""}
                </span>
                <span className="city-max-info">
                  {detail?.current?.max_temp_time
                    ? `峰值 @ ${detail.current.max_temp_time}`
                    : ""}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
