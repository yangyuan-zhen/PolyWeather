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
const FULL_REFRESH_INTERVAL_MS = 60_000;
const MARKET_REFRESH_INTERVAL_MS = 5_000;

type FilterMode = "all" | "market" | "high-risk";
type SortMode = "risk" | "edge" | "probability" | "updated";

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

function getRiskRank(level?: string | null) {
  const riskOrder: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  return riskOrder[String(level || "").toLowerCase()] ?? 9;
}

function getProbabilityPeak(detail?: CityDetail | null) {
  const buckets = Array.isArray(detail?.probabilities?.distribution_all)
    ? detail.probabilities?.distribution_all
    : Array.isArray(detail?.probabilities?.distribution)
      ? detail.probabilities?.distribution
      : [];
  return buckets.reduce((best, bucket) => {
    const next = Number(bucket?.probability ?? -1);
    return next > best ? next : best;
  }, -1);
}

function getPositiveEdge(detail?: CityDetail | null) {
  const analysis = detail?.market_scan?.price_analysis;
  const yesEdge = Number(analysis?.yes?.edge ?? Number.NEGATIVE_INFINITY);
  const noEdge = Number(analysis?.no?.edge ?? Number.NEGATIVE_INFINITY);
  return Math.max(yesEdge, noEdge, Number.NEGATIVE_INFINITY);
}

function hasMarket(detail?: CityDetail | null) {
  return Boolean(
    detail?.market_scan?.available &&
      ((Array.isArray(detail.market_scan.all_buckets) &&
        detail.market_scan.all_buckets.length > 0) ||
        (Array.isArray(detail.market_scan.top_buckets) &&
          detail.market_scan.top_buckets.length > 0)),
  );
}

function ProbabilityHubScreen() {
  const { locale } = useI18n();
  const [cities, setCities] = useState<CityListItem[]>([]);
  const [detailsByName, setDetailsByName] = useState<Record<string, CityDetail>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [lastMarketUpdatedAt, setLastMarketUpdatedAt] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("risk");

  const fetchCityDetails = useCallback(
    async (cityList: CityListItem[], force: boolean) => {
      const fetched: Record<string, CityDetail> = {};

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

        const patch: Record<string, CityDetail> = {};
        results.forEach((result, batchIndex) => {
          if (result.status !== "fulfilled") return;
          const detail = result.value;
          fetched[batch[batchIndex].name] = detail;
          patch[batch[batchIndex].name] = detail;
        });

        if (Object.keys(patch).length) {
          setDetailsByName((previous) => ({
            ...previous,
            ...patch,
          }));
        }
      }

      return fetched;
    },
    [],
  );

  const refreshMarketScans = useCallback(async (
    sourceDetails?: Record<string, CityDetail>,
    sourceCities?: CityListItem[],
  ) => {
    const detailMap = sourceDetails || detailsByName;
    const cityList = sourceCities || cities;
    const loadedCities = cityList.filter((city) => detailMap[city.name]);
    if (!loadedCities.length) return;

    let touched = false;

    for (let index = 0; index < loadedCities.length; index += DETAIL_BATCH_SIZE) {
      const batch = loadedCities.slice(index, index + DETAIL_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((city) =>
          dashboardClient.getCityMarketScan(city.name, {
            force: true,
            targetDate: detailMap[city.name]?.local_date || null,
            marketSlug: detailMap[city.name]?.market_scan?.selected_slug || null,
          }),
        ),
      );

      const patch: Record<string, CityDetail> = {};
      results.forEach((result, batchIndex) => {
        if (result.status !== "fulfilled") return;
        const city = batch[batchIndex];
        const previous = detailMap[city.name] || detailsByName[city.name];
        if (!previous) return;
        const nextMarketScan = result.value.market_scan || previous.market_scan;
        if (!nextMarketScan) return;
        patch[city.name] = {
          ...previous,
          market_scan: nextMarketScan,
        };
      });

      if (Object.keys(patch).length) {
        touched = true;
        Object.assign(detailMap, patch);
        setDetailsByName((previous) => ({
          ...previous,
          ...patch,
        }));
      }
    }

    if (touched) {
      setLastMarketUpdatedAt(new Date().toISOString());
    }
  }, [cities, detailsByName]);

  const loadAll = useCallback(async (force = false) => {
    setError(null);
    setRefreshing(true);
    if (!cities.length || force) {
      setLoading(true);
    }
    try {
      const cityList = sortCities(await dashboardClient.getCities());
      setCities(cityList);
      const fetched = await fetchCityDetails(cityList, force);
      setLastUpdatedAt(new Date().toISOString());
      await refreshMarketScans(fetched, cityList);
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
  }, [cities.length, fetchCityDetails, locale, refreshMarketScans]);

  const retryMissingCities = useCallback(async () => {
    if (!cities.length) return;
    const missingCities = cities.filter((city) => !detailsByName[city.name]);
    if (!missingCities.length) return;

    try {
      const fetched = await fetchCityDetails(missingCities, true);
      setLastUpdatedAt(new Date().toISOString());
      await refreshMarketScans(fetched, missingCities);
    } catch {
      // keep silent; page-level retry should not override the main error banner
    }
  }, [cities, detailsByName, fetchCityDetails, refreshMarketScans]);

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void retryMissingCities();
    }, 20_000);

    return () => window.clearInterval(timer);
  }, [retryMissingCities]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadAll(true);
    }, FULL_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [loadAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshMarketScans();
    }, MARKET_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [refreshMarketScans]);

  const loadedCount = Object.keys(detailsByName).length;
  const cityCount = cities.length;
  const readyCards = useMemo(
    () => cities.filter((city) => detailsByName[city.name]).length,
    [cities, detailsByName],
  );
  const marketReadyCount = useMemo(
    () => cities.filter((city) => hasMarket(detailsByName[city.name])).length,
    [cities, detailsByName],
  );
  const positiveEdgeCount = useMemo(
    () =>
      cities.filter((city) => {
        const edge = getPositiveEdge(detailsByName[city.name]);
        return Number.isFinite(edge) && edge > 0;
      }).length,
    [cities, detailsByName],
  );
  const visibleCities = useMemo(() => {
    const filtered = cities.filter((city) => {
      const detail = detailsByName[city.name];
      if (filterMode === "market") return hasMarket(detail);
      if (filterMode === "high-risk") {
        return String(detail?.risk?.level || city.risk_level || "").toLowerCase() === "high";
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const detailA = detailsByName[a.name];
      const detailB = detailsByName[b.name];

      if (sortMode === "edge") {
        const edgeDelta = getPositiveEdge(detailB) - getPositiveEdge(detailA);
        if (Number.isFinite(edgeDelta) && edgeDelta !== 0) return edgeDelta;
      }

      if (sortMode === "probability") {
        const probabilityDelta = getProbabilityPeak(detailB) - getProbabilityPeak(detailA);
        if (Number.isFinite(probabilityDelta) && probabilityDelta !== 0) return probabilityDelta;
      }

      if (sortMode === "updated") {
        const updatedDelta =
          new Date(detailB?.updated_at || 0).getTime() -
          new Date(detailA?.updated_at || 0).getTime();
        if (updatedDelta !== 0) return updatedDelta;
      }

      const riskDelta =
        getRiskRank(detailA?.risk?.level || a.risk_level) -
        getRiskRank(detailB?.risk?.level || b.risk_level);
      if (riskDelta !== 0) return riskDelta;

      return String(a.display_name || a.name).localeCompare(
        String(b.display_name || b.name),
      );
    });
  }, [cities, detailsByName, filterMode, sortMode]);

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
                {locale === "en-US" ? "Market" : "有市场"} <strong>{marketReadyCount}</strong>
              </span>
              <span className={styles.heroPill}>
                {locale === "en-US" ? "Positive edge" : "有优势"} <strong>{positiveEdgeCount}</strong>
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
              <span className={styles.heroPill}>
                {locale === "en-US" ? "Market tick" : "价格更新"}{" "}
                <strong>
                  {lastMarketUpdatedAt
                    ? new Date(lastMarketUpdatedAt).toLocaleTimeString(
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

        <section className={styles.toolbar}>
          <div className={styles.toolbarGroup}>
            <span className={styles.toolbarLabel}>
              {locale === "en-US" ? "Filter" : "筛选"}
            </span>
            <button
              type="button"
              className={clsx(styles.toolbarButton, filterMode === "all" && styles.active)}
              onClick={() => setFilterMode("all")}
            >
              {locale === "en-US" ? "All" : "全部"}
            </button>
            <button
              type="button"
              className={clsx(styles.toolbarButton, filterMode === "market" && styles.active)}
              onClick={() => setFilterMode("market")}
            >
              {locale === "en-US" ? "With market" : "仅看有市场"}
            </button>
            <button
              type="button"
              className={clsx(styles.toolbarButton, filterMode === "high-risk" && styles.active)}
              onClick={() => setFilterMode("high-risk")}
            >
              {locale === "en-US" ? "High risk" : "仅看高风险"}
            </button>
          </div>
          <div className={styles.toolbarGroup}>
            <span className={styles.toolbarLabel}>
              {locale === "en-US" ? "Sort" : "排序"}
            </span>
            <button
              type="button"
              className={clsx(styles.toolbarButton, sortMode === "risk" && styles.active)}
              onClick={() => setSortMode("risk")}
            >
              {locale === "en-US" ? "Risk" : "风险"}
            </button>
            <button
              type="button"
              className={clsx(styles.toolbarButton, sortMode === "edge" && styles.active)}
              onClick={() => setSortMode("edge")}
            >
              {locale === "en-US" ? "Edge" : "优势"}
            </button>
            <button
              type="button"
              className={clsx(styles.toolbarButton, sortMode === "probability" && styles.active)}
              onClick={() => setSortMode("probability")}
            >
              {locale === "en-US" ? "Probability" : "概率"}
            </button>
            <button
              type="button"
              className={clsx(styles.toolbarButton, sortMode === "updated" && styles.active)}
              onClick={() => setSortMode("updated")}
            >
              {locale === "en-US" ? "Updated" : "更新时间"}
            </button>
          </div>
          <div className={styles.toolbarSummary}>
            {locale === "en-US"
              ? `${visibleCities.length} cards in view`
              : `当前显示 ${visibleCities.length} 张卡片`}
          </div>
        </section>

        {loading && loadedCount === 0 ? (
          <div className={styles.loadingGrid}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.loadingCard} />
            ))}
          </div>
        ) : (
          <div className={styles.grid}>
            {visibleCities.map((city) => {
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
