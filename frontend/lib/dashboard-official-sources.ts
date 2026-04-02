import type { CityDetail } from "@/lib/dashboard-types";

export type OfficialSourceLink = {
  label: string;
  href: string;
  kind: "agency" | "airport" | "metar";
};

const CITY_SPECIFIC_SOURCES: Record<string, OfficialSourceLink[]> = {
  singapore: [
    {
      label: "MSS 官方天气",
      href: "https://www.weather.gov.sg/",
      kind: "agency",
    },
    {
      label: "樟宜机场",
      href: "https://www.changiairport.com/",
      kind: "airport",
    },
    {
      label: "WSSS METAR",
      href: "https://aviationweather.gov/data/metar/?id=WSSS&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  wellington: [
    {
      label: "MetService",
      href: "https://www.metservice.com/",
      kind: "agency",
    },
    {
      label: "Wellington Airport",
      href: "https://www.wellingtonairport.co.nz/",
      kind: "airport",
    },
    {
      label: "NZWN METAR",
      href: "https://aviationweather.gov/data/metar/?id=NZWN&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  "hong kong": [
    {
      label: "香港天文台",
      href: "https://www.hko.gov.hk/en/index.html",
      kind: "agency",
    },
    {
      label: "香港国际机场",
      href: "https://www.hongkongairport.com/",
      kind: "airport",
    },
    {
      label: "VHHH METAR",
      href: "https://aviationweather.gov/data/metar/?id=VHHH&decoded=1&taf=1",
      kind: "metar",
    },
    {
      label: "流浮山站（HKO）",
      href: "https://www.hko.gov.hk/sc/wxinfo/ts/index.htm",
      kind: "agency",
    },
  ],
  "lau fau shan": [
    {
      label: "香港天文台",
      href: "https://www.hko.gov.hk/en/index.html",
      kind: "agency",
    },
    {
      label: "流浮山站（HKO）",
      href: "https://www.hko.gov.hk/sc/wxinfo/ts/index.htm",
      kind: "airport",
    },
  ],
  taipei: [
    {
      label: "Wunderground RCSS",
      href: "https://www.wunderground.com/history/daily/tw/taipei/RCSS",
      kind: "agency",
    },
    {
      label: "台北松山机场",
      href: "https://www.tsa.gov.tw/?lang=en",
      kind: "airport",
    },
    {
      label: "RCSS METAR",
      href: "https://aviationweather.gov/data/metar/?id=RCSS&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  istanbul: [
    {
      label: "MGM",
      href: "https://www.mgm.gov.tr/",
      kind: "agency",
    },
    {
      label: "NOAA LTFM Timeseries",
      href: "https://www.weather.gov/wrh/timeseries?site=LTFM",
      kind: "agency",
    },
    {
      label: "Istanbul Airport",
      href: "https://www.istairport.com/en",
      kind: "airport",
    },
    {
      label: "LTFM METAR",
      href: "https://aviationweather.gov/data/metar/?id=LTFM&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  moscow: [
    {
      label: "NOAA UUWW Timeseries",
      href: "https://www.weather.gov/wrh/timeseries?site=UUWW",
      kind: "agency",
    },
    {
      label: "Vnukovo International Airport",
      href: "https://vnukovo.ru/en/",
      kind: "airport",
    },
    {
      label: "UUWW METAR",
      href: "https://metar-taf.com/UUWW",
      kind: "metar",
    },
  ],
  london: [
    {
      label: "Met Office",
      href: "https://www.metoffice.gov.uk/",
      kind: "agency",
    },
    {
      label: "EGLC METAR",
      href: "https://aviationweather.gov/data/metar/?id=EGLC&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  "new york": [
    {
      label: "NWS",
      href: "https://www.weather.gov/",
      kind: "agency",
    },
    {
      label: "KLGA METAR",
      href: "https://aviationweather.gov/data/metar/?id=KLGA&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  "los angeles": [
    {
      label: "NWS Los Angeles/Oxnard",
      href: "https://www.weather.gov/lox/",
      kind: "agency",
    },
    {
      label: "LAX Airport",
      href: "https://www.flylax.com/",
      kind: "airport",
    },
    {
      label: "KLAX METAR",
      href: "https://aviationweather.gov/data/metar/?id=KLAX&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  "san francisco": [
    {
      label: "NWS San Francisco Bay Area",
      href: "https://www.weather.gov/mtr/",
      kind: "agency",
    },
    {
      label: "SFO Airport",
      href: "https://www.flysfo.com/",
      kind: "airport",
    },
    {
      label: "KSFO METAR",
      href: "https://aviationweather.gov/data/metar/?id=KSFO&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  aurora: [
    {
      label: "NWS Denver/Boulder",
      href: "https://www.weather.gov/bou/",
      kind: "agency",
    },
    {
      label: "Buckley Space Force Base",
      href: "https://www.buckley.spaceforce.mil/",
      kind: "airport",
    },
    {
      label: "KBKF METAR",
      href: "https://aviationweather.gov/data/metar/?id=KBKF&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  austin: [
    {
      label: "NWS Austin/San Antonio",
      href: "https://www.weather.gov/ewx/",
      kind: "agency",
    },
    {
      label: "Austin-Bergstrom Airport",
      href: "https://www.austintexas.gov/airport",
      kind: "airport",
    },
    {
      label: "KAUS METAR",
      href: "https://aviationweather.gov/data/metar/?id=KAUS&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  houston: [
    {
      label: "NWS Houston/Galveston",
      href: "https://www.weather.gov/hgx/",
      kind: "agency",
    },
    {
      label: "William P. Hobby Airport",
      href: "https://www.fly2houston.com/hobby",
      kind: "airport",
    },
    {
      label: "KHOU METAR",
      href: "https://aviationweather.gov/data/metar/?id=KHOU&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  "mexico city": [
    {
      label: "SMN",
      href: "https://smn.conagua.gob.mx/",
      kind: "agency",
    },
    {
      label: "AICM",
      href: "https://www.aicm.com.mx/",
      kind: "airport",
    },
    {
      label: "MMMX METAR",
      href: "https://aviationweather.gov/data/metar/?id=MMMX&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  ankara: [
    {
      label: "MGM",
      href: "https://www.mgm.gov.tr/",
      kind: "agency",
    },
    {
      label: "LTAC METAR",
      href: "https://aviationweather.gov/data/metar/?id=LTAC&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  paris: [
    {
      label: "Météo-France",
      href: "https://meteofrance.com/",
      kind: "agency",
    },
    {
      label: "LFPG METAR",
      href: "https://aviationweather.gov/data/metar/?id=LFPG&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  seoul: [
    {
      label: "KMA",
      href: "https://www.weather.go.kr/",
      kind: "agency",
    },
    {
      label: "RKSI METAR",
      href: "https://aviationweather.gov/data/metar/?id=RKSI&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  shanghai: [
    {
      label: "中国天气网",
      href: "https://www.weather.com.cn/",
      kind: "agency",
    },
    {
      label: "ZSPD METAR",
      href: "https://aviationweather.gov/data/metar/?id=ZSPD&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  tokyo: [
    {
      label: "JMA",
      href: "https://www.jma.go.jp/jma/indexe.html",
      kind: "agency",
    },
    {
      label: "RJTT METAR",
      href: "https://aviationweather.gov/data/metar/?id=RJTT&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  "tel aviv": [
    {
      label: "IMS",
      href: "https://ims.gov.il/en",
      kind: "agency",
    },
    {
      label: "LLBG METAR",
      href: "https://aviationweather.gov/data/metar/?id=LLBG&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  toronto: [
    {
      label: "Environment Canada",
      href: "https://weather.gc.ca/",
      kind: "agency",
    },
    {
      label: "CYYZ METAR",
      href: "https://aviationweather.gov/data/metar/?id=CYYZ&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  "buenos aires": [
    {
      label: "SMN",
      href: "https://www.smn.gob.ar/",
      kind: "agency",
    },
    {
      label: "SAEZ METAR",
      href: "https://aviationweather.gov/data/metar/?id=SAEZ&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  chicago: [
    {
      label: "NWS Chicago",
      href: "https://www.weather.gov/lot/",
      kind: "agency",
    },
    {
      label: "KORD METAR",
      href: "https://aviationweather.gov/data/metar/?id=KORD&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  dallas: [
    {
      label: "NWS Fort Worth",
      href: "https://www.weather.gov/fwd/",
      kind: "agency",
    },
    {
      label: "KDAL METAR",
      href: "https://aviationweather.gov/data/metar/?id=KDAL&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  miami: [
    {
      label: "NWS Miami",
      href: "https://www.weather.gov/mfl/",
      kind: "agency",
    },
    {
      label: "KMIA METAR",
      href: "https://aviationweather.gov/data/metar/?id=KMIA&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  atlanta: [
    {
      label: "NWS Peachtree City",
      href: "https://www.weather.gov/ffc/",
      kind: "agency",
    },
    {
      label: "KATL METAR",
      href: "https://aviationweather.gov/data/metar/?id=KATL&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  seattle: [
    {
      label: "NWS Seattle",
      href: "https://www.weather.gov/sew/",
      kind: "agency",
    },
    {
      label: "KSEA METAR",
      href: "https://aviationweather.gov/data/metar/?id=KSEA&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  lucknow: [
    {
      label: "IMD",
      href: "https://mausam.imd.gov.in/",
      kind: "agency",
    },
    {
      label: "VILK METAR",
      href: "https://aviationweather.gov/data/metar/?id=VILK&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  "sao paulo": [
    {
      label: "INMET",
      href: "https://portal.inmet.gov.br/",
      kind: "agency",
    },
    {
      label: "SBGR METAR",
      href: "https://aviationweather.gov/data/metar/?id=SBGR&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  munich: [
    {
      label: "DWD",
      href: "https://www.dwd.de/EN/Home/home_node.html",
      kind: "agency",
    },
    {
      label: "EDDM METAR",
      href: "https://aviationweather.gov/data/metar/?id=EDDM&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  milan: [
    {
      label: "MeteoAM",
      href: "https://www.meteoam.it/en/home",
      kind: "agency",
    },
    {
      label: "LIMC METAR",
      href: "https://aviationweather.gov/data/metar/?id=LIMC&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  warsaw: [
    {
      label: "IMGW",
      href: "https://meteo.imgw.pl/",
      kind: "agency",
    },
    {
      label: "EPWA METAR",
      href: "https://aviationweather.gov/data/metar/?id=EPWA&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  madrid: [
    {
      label: "AEMET",
      href: "https://www.aemet.es/en/portada",
      kind: "agency",
    },
    {
      label: "LEMD METAR",
      href: "https://aviationweather.gov/data/metar/?id=LEMD&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  chengdu: [
    {
      label: "中国天气网",
      href: "https://www.weather.com.cn/",
      kind: "agency",
    },
    {
      label: "ZUUU METAR",
      href: "https://aviationweather.gov/data/metar/?id=ZUUU&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  chongqing: [
    {
      label: "中国天气网",
      href: "https://www.weather.com.cn/",
      kind: "agency",
    },
    {
      label: "ZUCK METAR",
      href: "https://aviationweather.gov/data/metar/?id=ZUCK&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  shenzhen: [
    {
      label: "Wunderground ZGSZ",
      href: "https://www.wunderground.com/history/daily/cn/shenzhen/ZGSZ",
      kind: "agency",
    },
    {
      label: "深圳宝安国际机场",
      href: "https://www.szairport.com/",
      kind: "airport",
    },
    {
      label: "ZGSZ METAR",
      href: "https://aviationweather.gov/data/metar/?id=ZGSZ&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  beijing: [
    {
      label: "中国天气网",
      href: "https://www.weather.com.cn/",
      kind: "agency",
    },
    {
      label: "ZBAA METAR",
      href: "https://aviationweather.gov/data/metar/?id=ZBAA&decoded=1&taf=1",
      kind: "metar",
    },
  ],
  wuhan: [
    {
      label: "中国天气网",
      href: "https://www.weather.com.cn/",
      kind: "agency",
    },
    {
      label: "ZHHH METAR",
      href: "https://aviationweather.gov/data/metar/?id=ZHHH&decoded=1&taf=1",
      kind: "metar",
    },
  ],
};

export function getOfficialSourceLinks(detail: CityDetail): OfficialSourceLink[] {
  const cityKey = String(detail.name || "").trim().toLowerCase();
  const links = [...(CITY_SPECIFIC_SOURCES[cityKey] || [])];
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.label}|${link.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
