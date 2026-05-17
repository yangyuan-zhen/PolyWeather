import type {
  CityDetail,
  CityListItem,
  CitySummary,
} from "@/lib/dashboard-types";

const CITY_NAME_ZH: Record<string, string> = {
  Amsterdam: "阿姆斯特丹",
  Ankara: "安卡拉",
  Atlanta: "亚特兰大",
  Austin: "奥斯汀",
  Beijing: "北京",
  "Buenos Aires": "布宜诺斯艾利斯",
  Busan: "釜山",
  "Cape Town": "开普敦",
  Chengdu: "成都",
  Chicago: "芝加哥",
  Chongqing: "重庆",
  Dallas: "达拉斯",
  Denver: "丹佛",
  Guangzhou: "广州",
  Helsinki: "赫尔辛基",
  "Hong Kong": "香港",
  Houston: "休斯敦",
  Istanbul: "伊斯坦布尔",
  Jakarta: "雅加达",
  Jeddah: "吉达",
  Karachi: "卡拉奇",
  "Lau Fau Shan": "流浮山",
  London: "伦敦",
  Lucknow: "勒克瑙",
  Madrid: "马德里",
  Manila: "马尼拉",
  Miami: "迈阿密",
  Milan: "米兰",
  Moscow: "莫斯科",
  "Mexico City": "墨西哥城",
  Munich: "慕尼黑",
  "New York": "纽约",
  Panama: "巴拿马城",
  "Panama City": "巴拿马城",
  Paris: "巴黎",
  Qingdao: "青岛",
  "Sao Paulo": "圣保罗",
  "São Paulo": "圣保罗",
  Seattle: "西雅图",
  Seoul: "首尔",
  Shenzhen: "深圳",
  Singapore: "新加坡",
  Taipei: "台北",
  Tokyo: "东京",
  Toronto: "多伦多",
  Warsaw: "华沙",
  Wellington: "惠灵顿",
  Wuhan: "武汉",
};

const AIRPORT_NAME_ZH: Record<string, string> = {
  Amsterdam: "史基浦机场",
  Ankara: "安卡拉埃森博阿机场",
  Atlanta: "哈茨菲尔德-杰克逊亚特兰大国际机场",
  Austin: "奥斯汀-伯格斯特龙国际机场",
  Beijing: "北京首都国际机场",
  "Buenos Aires": "埃塞萨国际机场",
  Busan: "金海国际机场",
  "Cape Town": "开普敦国际机场",
  Chengdu: "成都双流国际机场",
  Chicago: "奥黑尔国际机场",
  Chongqing: "重庆江北国际机场",
  Dallas: "达拉斯爱田机场",
  Denver: "丹佛国际机场",
  Guangzhou: "广州白云国际机场",
  Helsinki: "赫尔辛基机场",
  "Hong Kong": "香港天文台总部",
  Houston: "乔治布什洲际机场",
  Istanbul: "伊斯坦布尔机场",
  Jakarta: "苏加诺-哈达国际机场",
  Jeddah: "阿卜杜勒-阿齐兹国王国际机场",
  Karachi: "真纳国际机场",
  "Lau Fau Shan": "流浮山监测站",
  London: "希思罗机场",
  Lucknow: "乔杜里·查兰·辛格国际机场",
  Madrid: "马德里-巴拉哈斯机场",
  Manila: "尼诺伊·阿基诺国际机场",
  Miami: "迈阿密国际机场",
  Milan: "米兰马尔彭萨机场",
  Moscow: "谢列梅捷沃国际机场",
  "Mexico City": "墨西哥城贝尼托·胡亚雷斯国际机场",
  Munich: "慕尼黑机场",
  "New York": "拉瓜迪亚机场",
  "Panama City": "托库门国际机场",
  Paris: "戴高乐机场",
  Qingdao: "青岛胶东国际机场",
  "Sao Paulo": "瓜鲁柳斯国际机场",
  "São Paulo": "瓜鲁柳斯国际机场",
  Seattle: "西雅图-塔科马国际机场",
  Seoul: "仁川国际机场",
  Shenzhen: "深圳宝安国际机场",
  Singapore: "樟宜机场",
  Taipei: "台北松山机场",
  Tokyo: "羽田机场",
  Toronto: "多伦多皮尔逊国际机场",
  Warsaw: "华沙肖邦机场",
  Wellington: "惠灵顿机场",
  Wuhan: "武汉天河国际机场",
};

const AIRPORT_NAME_EN: Record<string, string> = {
  "Hong Kong": "Hong Kong Observatory HQ",
  "Lau Fau Shan": "Lau Fau Shan Monitoring Station",
};

function normalizeCityKey(value: string | null | undefined) {
  return String(value || "").trim();
}

export function getLocalizedCityName(
  cityName: string | null | undefined,
  fallback: string | null | undefined,
  locale: string,
) {
  const key = normalizeCityKey(cityName);
  const text = String(fallback || "").trim() || key;
  if (locale === "en-US") return text;
  return CITY_NAME_ZH[key] || text;
}

export function getLocalizedAirportName(
  cityName: string | null | undefined,
  fallback: string | null | undefined,
  locale: string,
) {
  const key = normalizeCityKey(cityName);
  const text = String(fallback || "").trim();
  if (locale === "en-US") {
    return AIRPORT_NAME_EN[key] || text;
  }
  return AIRPORT_NAME_ZH[key] || text;
}

export function getLocalizedCityDisplay(
  city: CityListItem,
  locale: string,
  summary?: CitySummary | null,
  detail?: CityDetail | null,
) {
  return getLocalizedCityName(
    city.name,
    summary?.display_name || detail?.display_name || city.display_name,
    locale,
  );
}

export function getLocalizedAirportDisplay(
  city: CityListItem,
  locale: string,
  detail?: CityDetail | null,
) {
  return getLocalizedAirportName(
    city.name,
    city.airport || detail?.risk?.airport || detail?.settlement_station?.airport_name,
    locale,
  );
}
