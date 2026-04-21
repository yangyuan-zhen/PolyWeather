"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import dashboardStyles from "@/components/dashboard/Dashboard.module.css";
import { HeaderBar } from "@/components/dashboard/HeaderBar";
import { ProbabilityDistribution } from "@/components/dashboard/PanelSections";
import { dashboardClient } from "@/lib/dashboard-client";
import type { CityDetail, CityListItem } from "@/lib/dashboard-types";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { DashboardStoreProvider } from "@/hooks/useDashboardStore";
import styles from "./ProbabilityHubPage.module.css";

const DETAIL_BATCH_SIZE = 6;

function sortCities(cities: CityListItem[]) {
  const riskOrder: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return [...cities].sort((a, b) => {
    const riskDelta =
      (riskOrder[String(a.risk_level || "").toLowerCase()] ?? 9) -
      (riskOrder[String(b.risk_level || "").toLowerCase()] ?? 9);
    if (riskDelta !== 0) return riskDelta;
    return String(a.display_name || a.name).localeCompare(
      String(b.display_name || b.name),
    );
  });
}

function ProbabilityHubScreen() {
  const { locale } = useI18n();
  const [cities, setCities] = useState<CityListItem[]>([]);
  const [detailsByName, setDetailsByName] = useState<Record<string, CityDetail>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const loadAll = useCallback(async (force = false) => {
    setError(null);
    setRefreshing(true);
    if (!cities.length || force) {
      setLoading(true);
    }

    try {
      const cityList = sortCities(await dashboardClient.getCities());
      setCities(cityList);

      const nextDetails: Record<string, CityDetail> = {};
      for (let index = 0; index < cityList.length; index += DETAIL_BATCH_SIZE) {
        const batch = cityList.slice(index, index + DETAIL_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((city) =>
            dashboardClient.getCityDetail(city.name, {
              depth: "market",
              force,
            }),
          ),
        );

        results.forEach((result, batchIndex) => {
          if (result.status !== "fulfilled") return;
          nextDetails[batch[batchIndex].name] = result.value;
        });

        setDetailsByName((previous) => ({
          ...previous,
          ...nextDetails,
        }));
      }

      setLastUpdatedAt(new Date().toISOString());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : locale === "en-US"
            ? "Failed to load probability hub"
            : "加载概率页失败",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cities.length, locale]);

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  const loadedCount = Object.keys(detailsByName).length;
  const cityCount = cities.length;
  const readyCards = useMemo(
    () => cities.filter((city) => detailsByName[city.name]).length,
    [cities, detailsByName],
  );

  return (
    <div className={clsx(dashboardStyles.root, styles.pageRoot)}>
      <HeaderBar
        refreshAction={() => loadAll(true)}
        refreshSpinning={refreshing}
      />
      <main className={styles.pageBody}>
        <section className={styles.hero}>
          <div className={styles.heroCard}>
            <div className={styles.heroTitle}>
              {locale === "en-US"
                ? "52-city probability hub"
                : "52 城市概率判断总览"}
            </div>
            <div className={styles.heroText}>
              {locale === "en-US"
                ? "This page centralizes the intraday probability block for all monitored cities. The goal is fast scanning: see calibrated EMOS probabilities, market bucket alignment, and price comparison without opening each city modal one by one."
                : "这里把 52 个监控城市的概率判断板块集中到一个页面，方便直接横向扫一遍，不用逐个打开城市弹窗。重点看 EMOS 校准概率、市场合约桶聚合，以及价格对比。"}
            </div>
            <div className={styles.heroMeta}>
              <span className={styles.heroPill}>
                {locale === "en-US" ? "Cities" : "城市数"} <strong>{cityCount || "--"}</strong>
              </span>
              <span className={styles.heroPill}>
                {locale === "en-US" ? "Ready" : "已加载"} <strong>{readyCards}</strong>
              </span>
              <span className={styles.heroPill}>
                {locale === "en-US" ? "Updated" : "更新时间"}{" "}
                <strong>
                  {lastUpdatedAt
                    ? new Date(lastUpdatedAt).toLocaleTimeString(
                        locale === "en-US" ? "en-US" : "zh-CN",
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        },
                      )
                    : "--"}
                </strong>
              </span>
            </div>
          </div>

          {error ? <div className={styles.errorCard}>{error}</div> : null}
        </section>

        {loading && loadedCount === 0 ? (
          <div className={styles.loadingGrid}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.loadingCard} />
            ))}
          </div>
        ) : (
          <div className={styles.grid}>
            {cities.map((city) => {
              const detail = detailsByName[city.name];
              if (!detail) {
                return (
                  <section key={city.name} className={styles.card}>
                    <div className={styles.cardHead}>
                      <div className={styles.cardTitleBlock}>
                        <div className={styles.cardTitle}>{city.display_name}</div>
                        <div className={styles.cardSubTitle}>
                          {city.airport} ({city.icao})
                        </div>
                      </div>
                    </div>
                    <div className={styles.cardSubTitle}>
                      {locale === "en-US"
                        ? "Probability block is syncing..."
                        : "概率板块同步中..."}
                    </div>
                  </section>
                );
              }

              return (
                <section key={city.name} className={styles.card}>
                  <div className={styles.cardHead}>
                    <div className={styles.cardTitleBlock}>
                      <div className={styles.cardTitle}>{detail.display_name}</div>
                      <div className={styles.cardSubTitle}>
                        {detail.risk?.airport || city.airport} ({detail.risk?.icao || city.icao})
                      </div>
                    </div>
                  </div>
                  <div className={styles.cardMeta}>
                    <span className={styles.metaChip}>
                      {locale === "en-US" ? "Current" : "当前"}{" "}
                      <strong>
                        {detail.current?.temp != null
                          ? `${detail.current.temp}${detail.temp_symbol}`
                          : "--"}
                      </strong>
                    </span>
                    <span className={styles.metaChip}>
                      {locale === "en-US" ? "Obs" : "观测"}{" "}
                      <strong>{detail.current?.obs_time || "--"}</strong>
                    </span>
                    <span className={styles.metaChip}>
                      {locale === "en-US" ? "Updated" : "更新"}{" "}
                      <strong>
                        {detail.updated_at
                          ? new Date(detail.updated_at).toLocaleTimeString(
                              locale === "en-US" ? "en-US" : "zh-CN",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )
                          : "--"}
                      </strong>
                    </span>
                  </div>
                  <ProbabilityDistribution
                    detail={detail}
                    hideTitle
                    marketScan={detail.market_scan}
                  />
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export function ProbabilityHubPage() {
  return (
    <I18nProvider>
      <DashboardStoreProvider>
        <ProbabilityHubScreen />
      </DashboardStoreProvider>
    </I18nProvider>
  );
}
