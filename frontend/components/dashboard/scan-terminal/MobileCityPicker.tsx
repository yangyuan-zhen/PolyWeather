"use client";

import { Search, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";

type Locale = "zh-CN" | "en-US";

type CityRegionGroup = {
  key: string;
  label: { en: string; zh: string };
  cities: string[];
};

const CITY_REGION_GROUPS: CityRegionGroup[] = [
  {
    key: "eastAsia",
    label: { en: "East Asia", zh: "东亚" },
    cities: [
      "tokyo", "seoul", "busan", "beijing", "shanghai", "chengdu",
      "chongqing", "wuhan", "shenzhen", "guangzhou", "qingdao",
      "hong kong", "lau fau shan", "taipei",
    ],
  },
  {
    key: "southeastAsia",
    label: { en: "Southeast Asia", zh: "东南亚" },
    cities: ["singapore", "kuala lumpur", "jakarta", "manila"],
  },
  {
    key: "southAsia",
    label: { en: "South Asia", zh: "南亚" },
    cities: ["karachi", "lucknow"],
  },
  {
    key: "middleEast",
    label: { en: "Middle East", zh: "中东" },
    cities: ["tel aviv", "jeddah", "istanbul", "ankara"],
  },
  {
    key: "europe",
    label: { en: "Europe", zh: "欧洲" },
    cities: [
      "london", "paris", "moscow", "munich", "milan", "warsaw",
      "helsinki", "amsterdam", "madrid",
    ],
  },
  {
    key: "northAmerica",
    label: { en: "North America", zh: "北美" },
    cities: [
      "new york", "los angeles", "san francisco", "denver", "austin",
      "houston", "chicago", "dallas", "miami", "atlanta", "seattle",
      "toronto", "mexico city", "panama city",
    ],
  },
  {
    key: "southAmerica",
    label: { en: "South America", zh: "南美" },
    cities: ["buenos aires", "são paulo"],
  },
  {
    key: "africa",
    label: { en: "Africa", zh: "非洲" },
    cities: ["cape town"],
  },
  {
    key: "oceania",
    label: { en: "Oceania", zh: "大洋洲" },
    cities: ["wellington"],
  },
];

const CITY_SEARCH_INDEX: Record<string, string[]> = {
  "tokyo": ["东京", "東京", "RJTT", "tok", "tyo", "haneda", "羽田"],
  "seoul": ["首尔", "RKSI", "sel", "seo", "incheon", "仁川"],
  "busan": ["釜山", "RKPK", "pus", "bus", "gimhae", "金海"],
  "beijing": ["北京", "ZBAA", "pek", "bjs", "bj", "capital", "首都"],
  "shanghai": ["上海", "ZSPD", "sha", "sh", "pudong", "浦东"],
  "chengdu": ["成都", "ZUUU", "ctu", "cd", "shuangliu", "双流"],
  "chongqing": ["重庆", "ZUCK", "ckg", "cq", "jiangbei", "江北"],
  "wuhan": ["武汉", "ZHHH", "wuh", "wh", "tianhe", "天河"],
  "shenzhen": ["深圳", "ZGSZ", "szx", "sz", "baoan", "宝安"],
  "guangzhou": ["广州", "ZGGG", "can", "gz", "baiyun", "白云"],
  "qingdao": ["青岛", "青島", "ZSQD", "tao", "qdo", "jiaodong", "胶东"],
  "hong kong": ["香港", "VHHH", "hkg", "hk", "observatory", "天文台"],
  "lau fau shan": ["流浮山", "LFS", "lfs"],
  "taipei": ["台北", "臺北", "RCSS", "tpe", "tp", "台湾", "臺灣"],
  "singapore": ["新加坡", "WSSS", "sin", "sg", "changi", "樟宜"],
  "kuala lumpur": ["吉隆坡", "WMKK", "kul", "sepang", "雪邦"],
  "jakarta": ["雅加达", "雅加達", "WIHH", "jkt", "halim"],
  "manila": ["马尼拉", "馬尼拉", "RPLL", "mnl", "ninoy"],
  "karachi": ["卡拉奇", "OPKC", "khi", "jinnah", "真纳"],
  "lucknow": ["勒克瑙", "VILK", "luc"],
  "tel aviv": ["特拉维夫", "LLBG", "tlv", "ben gurion"],
  "jeddah": ["吉达", "吉達", "OEJN", "jed", "king abdulaziz", "阿卜杜勒阿齐兹"],
  "istanbul": ["伊斯坦布尔", "LTFM", "ist", "ltfm"],
  "ankara": ["安卡拉", "LTAC", "ank", "esenboğa"],
  "london": ["伦敦", "EGLC", "lon", "city airport"],
  "paris": ["巴黎", "LFPB", "par", "le bourget"],
  "moscow": ["莫斯科", "UUWW", "mos", "mow", "vnukovo"],
  "munich": ["慕尼黑", "EDDM", "mun"],
  "milan": ["米兰", "米蘭", "LIMC", "mil", "mxp", "malpensa", "马尔彭萨"],
  "warsaw": ["华沙", "華沙", "EPWA", "waw", "war", "chopin", "肖邦"],
  "helsinki": ["赫尔辛基", "赫爾辛基", "EFHK", "hel", "vantaa"],
  "amsterdam": ["阿姆斯特丹", "EHAM", "ams", "schiphol", "史基浦"],
  "madrid": ["马德里", "馬德里", "LEMD", "mad", "barajas"],
  "new york": ["纽约", "KLGA", "nyc", "ny", "laguardia"],
  "los angeles": ["洛杉矶", "KLAX", "la", "lax"],
  "san francisco": ["旧金山", "KSFO", "sf", "sfo"],
  "denver": ["丹佛", "奥罗拉", "KBKF", "aur", "buckley"],
  "austin": ["奥斯汀", "KAUS", "aus"],
  "houston": ["休斯顿", "KHOU", "hou", "hobby"],
  "chicago": ["芝加哥", "KORD", "chi", "ohare"],
  "dallas": ["达拉斯", "KDAL", "dal", "love field"],
  "miami": ["迈阿密", "KMIA", "mia"],
  "atlanta": ["亚特兰大", "KATL", "atl", "hartsfield"],
  "seattle": ["西雅图", "KSEA", "sea", "seatac"],
  "toronto": ["多伦多", "CYYZ", "tor", "pearson"],
  "mexico city": ["墨西哥城", "MMMX", "cdmx"],
  "panama city": ["巴拿马城", "MPMG", "pty"],
  "buenos aires": ["布宜诺斯艾利斯", "SAEZ", "ba", "ezeiza"],
  "são paulo": ["圣保罗", "SBGR", "sp", "guarulhos"],
"cape town": ["开普敦", "開普敦", "FACT", "cpt"],
  "wellington": ["惠灵顿", "NZWN", "wel"],
};

function normalizeCityKey(name: string): string {
  return String(name || "").trim().toLowerCase();
}

function matchesCitySearch(
  cityKey: string,
  displayName: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (cityKey.includes(q)) return true;
  if (displayName.toLowerCase().includes(q)) return true;
  const aliases = CITY_SEARCH_INDEX[cityKey];
  if (!aliases) return false;
  return aliases.some((alias) => alias.toLowerCase().includes(q));
}

function pickCityRow(
  rows: ScanOpportunityRow[],
  cityKey: string,
): ScanOpportunityRow | null {
  return (
    rows.find(
      (row) => normalizeCityKey(row.city) === cityKey,
    ) || null
  );
}

export function MobileCityPicker({
  isEn,
  rows,
  onSelectCity,
}: {
  isEn: boolean;
  rows: ScanOpportunityRow[];
  onSelectCity: (row: ScanOpportunityRow) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(
    () => new Set(CITY_REGION_GROUPS.map((g) => g.key)),
  );

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return CITY_REGION_GROUPS
      .map((group) => {
        const matched = group.cities.filter((cityKey) => {
          const row = pickCityRow(rows, cityKey);
          if (!row) return false;
          const display =
            row.city_display_name || row.display_name || cityKey;
          return matchesCitySearch(cityKey, display, q);
        });
        return { ...group, matched };
      })
      .filter((group) => group.matched.length > 0);
  }, [rows, searchQuery]);

  const totalMatched = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.matched.length, 0),
    [filteredGroups],
  );

  const toggleRegion = (key: string) => {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="scan-mobile-city-picker">
      <div className="scan-mobile-picker-search">
        <Search size={16} className="scan-mobile-picker-search-icon" />
        <input
          type="text"
          className="scan-mobile-picker-search-input"
          placeholder={
            isEn
              ? "Search city, airport code, or Chinese name..."
              : "搜索城市、机场代码或中文名..."
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery ? (
          <button
            type="button"
            className="scan-mobile-picker-search-clear"
            onClick={() => setSearchQuery("")}
          >
            ✕
          </button>
        ) : null}
      </div>

      {searchQuery ? (
        <div className="scan-mobile-picker-result-count">
          {isEn
            ? `${totalMatched} city${totalMatched !== 1 ? "ies" : "y"} found`
            : `找到 ${totalMatched} 个城市`}
        </div>
      ) : null}

      {filteredGroups.length === 0 ? (
        <div className="scan-mobile-picker-empty">
          {isEn ? "No cities match your search" : "没有匹配的城市"}
        </div>
      ) : (
        <div className="scan-mobile-picker-regions">
          {filteredGroups.map((group) => {
            const isExpanded = expandedRegions.has(group.key) || !!searchQuery;
            return (
              <div key={group.key} className="scan-mobile-picker-region">
                <button
                  type="button"
                  className="scan-mobile-picker-region-head"
                  onClick={() => toggleRegion(group.key)}
                >
                  <span>
                    {isEn ? group.label.en : group.label.zh}
                    <small>{group.matched.length}</small>
                  </span>
                  <ChevronDown
                    size={16}
                    className={isExpanded ? "expanded" : ""}
                  />
                </button>
                {isExpanded ? (
                  <div className="scan-mobile-picker-region-cities">
                    {group.matched.map((cityKey) => {
                      const row = pickCityRow(rows, cityKey);
                      if (!row) return null;
                      const display =
                        row.city_display_name ||
                        row.display_name ||
                        cityKey;
                      const currentTemp =
                        row.current_temp ?? row.current_max_so_far ?? null;
                      const deb = row.deb_prediction ?? null;
                      const tempUnit = row.temp_symbol || "°C";
                      return (
                        <button
                          key={cityKey}
                          type="button"
                          className="scan-mobile-picker-city-row"
                          onClick={() => onSelectCity(row)}
                        >
                          <span className="scan-mobile-picker-city-name">
                            <b>{display}</b>
                            <small>
                              {row.airport || row.local_time || ""}
                            </small>
                          </span>
                          <span className="scan-mobile-picker-city-temp">
                            <b>
                              {currentTemp != null &&
                              Number.isFinite(Number(currentTemp))
                                ? `${Number(currentTemp).toFixed(1)}${tempUnit}`
                                : "--"}
                            </b>
                            <small>
                              DEB{" "}
                              {deb != null && Number.isFinite(Number(deb))
                                ? `${Number(deb).toFixed(1)}${tempUnit}`
                                : "--"}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
