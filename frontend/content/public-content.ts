export const PUBLIC_CONTENT_BASE_URL = "https://polyweather.top";

export type PublicBriefSignal = {
  label: string;
  value: string;
  detail: string;
};

export type PublicBrief = {
  city: string;
  cityName: string;
  countryName: string;
  date: string;
  title: string;
  description: string;
  market: string;
  settlementSource: string;
  updatedAt: string;
  publishedAt: string;
  dataFreshness: string;
  debRead: string;
  sourceRead: string;
  modelRead: string;
  riskRead: string;
  notFinancialAdvice: string;
  distributionText: string;
  primaryCtaLabel: string;
  sourceSlugs: string[];
  methodologySlugs: string[];
  signals: PublicBriefSignal[];
  checkpoints: string[];
};

export type MethodologyPage = {
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  summary: string;
  sections: Array<{
    heading: string;
    body: string;
    bullets: string[];
  }>;
};

export type SourcePage = {
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  operator: string;
  coverage: string;
  cadence: string;
  settlementUse: string;
  reliabilityNotes: string[];
  relatedMethodologySlugs: string[];
};

export const PUBLIC_BRIEFS: PublicBrief[] = [
  {
    city: "ankara",
    cityName: "Ankara",
    countryName: "Turkey",
    date: "2026-06-24",
    title: "Ankara Weather Market Brief - 24 Jun 2026",
    description:
      "A public market brief for Ankara maximum temperature judgment, focused on MGM settlement-source behavior, DEB blended forecast context, and anomaly checks.",
    market: "Same-day maximum temperature judgment",
    settlementSource: "MGM official station",
    updatedAt: "2026-06-24T13:55:00+03:00",
    publishedAt: "2026-06-24T13:55:00+03:00",
    dataFreshness:
      "Static public snapshot. Paid terminal users should verify the latest official observation and SSE replay state before acting.",
    debRead:
      "DEB kept the intraday high-temperature read below the isolated MGM spike and closer to the observed official range.",
    sourceRead:
      "MGM is treated as the primary settlement reference. A single 27.1 C point should be checked against adjacent official readings before it is accepted as a new high.",
    modelRead:
      "ECMWF was warmer than the DEB blend in the early afternoon window, but the public brief weights official observations above model-only movement.",
    riskRead:
      "Main risk is a late official update or a source-side correction that changes the recognized high after the public snapshot.",
    notFinancialAdvice:
      "This brief is weather-research content for prediction-market preparation. It is not financial advice and does not guarantee settlement outcomes.",
    distributionText:
      "Ankara 2026-06-24 public Weather Market Brief: MGM official readings favored a 24.5 C observed high over an isolated 27.1 C spike; DEB stayed below the outlier. Not financial advice.",
    primaryCtaLabel: "Open live terminal",
    sourceSlugs: ["mgm", "metar", "ecmwf"],
    methodologySlugs: ["deb", "settlement-sources"],
    signals: [
      {
        label: "Observed high so far",
        value: "24.5 C",
        detail: "Official-source value to compare against any isolated higher point.",
      },
      {
        label: "Outlier under review",
        value: "27.1 C",
        detail: "A sudden single-source value needs neighboring-time validation.",
      },
      {
        label: "DEB public read",
        value: "Below spike",
        detail: "Blend stayed closer to the verified observation band.",
      },
    ],
    checkpoints: [
      "Check whether the suspected spike appears in the official high-temperature summary.",
      "Compare adjacent MGM observations before treating a single point as settlement-relevant.",
      "Review the paid terminal for live chart patches and source freshness before market close.",
    ],
  },
  {
    city: "hong-kong",
    cityName: "Hong Kong",
    countryName: "Hong Kong",
    date: "2026-06-24",
    title: "Hong Kong Weather Market Brief - 24 Jun 2026",
    description:
      "A public brief showing how PolyWeather frames HKO/Cheung Chau/airport observations against DEB and model spread for maximum-temperature markets.",
    market: "Urban and airport maximum temperature judgment",
    settlementSource: "HKO official network",
    updatedAt: "2026-06-24T18:00:00+08:00",
    publishedAt: "2026-06-24T18:00:00+08:00",
    dataFreshness:
      "Static public snapshot. Live terminal values may differ as HKO and station caches refresh.",
    debRead:
      "DEB favored a narrow high-temperature window because live observations and model spread were aligned by late afternoon.",
    sourceRead:
      "HKO network observations remain the source family to reconcile before interpreting airport-only movement.",
    modelRead:
      "Model disagreement was limited, so source freshness and station selection mattered more than broad synoptic uncertainty.",
    riskRead:
      "Primary risk is station-specific heat retention during late afternoon or a late official summary revision.",
    notFinancialAdvice:
      "This brief is weather-research content for prediction-market preparation. It is not financial advice and does not guarantee settlement outcomes.",
    distributionText:
      "Hong Kong 2026-06-24 public Weather Market Brief: source selection and HKO freshness mattered more than model spread. Not financial advice.",
    primaryCtaLabel: "Open live terminal",
    sourceSlugs: ["hko", "metar"],
    methodologySlugs: ["deb", "settlement-sources"],
    signals: [
      {
        label: "Source family",
        value: "HKO",
        detail: "Use official station context before airport-only interpretation.",
      },
      {
        label: "Model spread",
        value: "Low",
        detail: "Late-day uncertainty mainly came from station behavior.",
      },
      {
        label: "Terminal need",
        value: "Freshness",
        detail: "Live source timestamps decide whether the public snapshot is still useful.",
      },
    ],
    checkpoints: [
      "Verify HKO station timestamps before comparing market bands.",
      "Separate airport METAR observations from settlement-source network readings.",
      "Check terminal source health if the public snapshot is older than one refresh cycle.",
    ],
  },
  {
    city: "new-york",
    cityName: "New York",
    countryName: "United States",
    date: "2026-06-24",
    title: "New York Weather Market Brief - 24 Jun 2026",
    description:
      "A public brief for New York temperature markets, connecting METAR, NOAA context, DEB blending, and late-day risk checks.",
    market: "Airport-linked maximum temperature judgment",
    settlementSource: "METAR and NOAA station context",
    updatedAt: "2026-06-24T12:30:00-04:00",
    publishedAt: "2026-06-24T12:30:00-04:00",
    dataFreshness:
      "Static public snapshot. Paid terminal users should check current METAR observations and official summaries.",
    debRead:
      "DEB weighted the latest observation trend against warmer model guidance instead of following the raw model high.",
    sourceRead:
      "METAR provides fast airport evidence, while NOAA context helps validate whether the airport value is representative.",
    modelRead:
      "Warm model guidance can be useful only after it is reconciled with live airport observations and cloud/wind context.",
    riskRead:
      "Primary risk is a short late-day break in cloud cover that lifts airport observations into a higher band.",
    notFinancialAdvice:
      "This brief is weather-research content for prediction-market preparation. It is not financial advice and does not guarantee settlement outcomes.",
    distributionText:
      "New York 2026-06-24 public Weather Market Brief: DEB blended warmer guidance against live airport evidence. Not financial advice.",
    primaryCtaLabel: "Open live terminal",
    sourceSlugs: ["metar", "noaa"],
    methodologySlugs: ["deb", "settlement-sources"],
    signals: [
      {
        label: "Fast evidence",
        value: "METAR",
        detail: "Airport observations define the short-cycle read.",
      },
      {
        label: "Validation",
        value: "NOAA",
        detail: "Official context helps audit the final high-temperature interpretation.",
      },
      {
        label: "DEB stance",
        value: "Blend",
        detail: "Do not follow a warm model run without live evidence confirmation.",
      },
    ],
    checkpoints: [
      "Watch the last two METAR cycles before the daily high window ends.",
      "Check whether model warmth is supported by cloud and wind observations.",
      "Use official source context before final settlement interpretation.",
    ],
  },
];

export const METHODOLOGY_PAGES: MethodologyPage[] = [
  {
    slug: "deb",
    title: "DEB Forecast Methodology",
    description:
      "How PolyWeather frames DEB blended forecasts for prediction-market temperature decisions without replacing settlement-source evidence.",
    updatedAt: "2026-06-24T00:00:00Z",
    summary:
      "DEB is the public name for PolyWeather's blended forecast layer. It reconciles model guidance, live observation momentum, source freshness, and station context so users can judge a high-temperature band with fewer single-model mistakes.",
    sections: [
      {
        heading: "What DEB is for",
        body:
          "DEB is not a settlement oracle. It is a decision-support layer that makes the live observation path and model spread easier to compare.",
        bullets: [
          "Prefer settlement-source evidence when it conflicts with model-only guidance.",
          "Treat stale or isolated source values as quality-control candidates.",
          "Expose the forecast band and the reason a band is widening or narrowing.",
        ],
      },
      {
        heading: "Inputs that matter",
        body:
          "The blend is useful because it combines different evidence classes instead of pretending one model run is enough.",
        bullets: [
          "Latest official or airport observations and their freshness.",
          "Model consensus and disagreement across ECMWF, GFS, ICON, GEM, and local sources when available.",
          "City-specific source behavior, station selection, and intraday high timing.",
        ],
      },
      {
        heading: "How to read a DEB miss",
        body:
          "A DEB miss should be reviewed by separating source freshness, model spread, and settlement-source revisions.",
        bullets: [
          "If the observed high changed after a late source patch, classify it as a freshness or replay issue.",
          "If every source was fresh but the high landed outside the band, review model weighting and local station features.",
          "If one source jumped alone, audit neighboring observations before retraining around the outlier.",
        ],
      },
    ],
  },
  {
    slug: "settlement-sources",
    title: "Settlement-Source Priority",
    description:
      "Why PolyWeather presents official settlement-related observations before generic weather API values.",
    updatedAt: "2026-06-24T00:00:00Z",
    summary:
      "Prediction-market users care about the number that resolves the contract. PolyWeather therefore puts official station, airport, and operator-specific source behavior above broad consumer-weather averages.",
    sections: [
      {
        heading: "Why generic weather values are not enough",
        body:
          "Consumer weather apps often smooth station data or display city-wide approximations. Market resolution can depend on a narrower official source.",
        bullets: [
          "A city label may hide multiple stations with different daily highs.",
          "Airport METAR can update faster than a public summary, but may not be the final settlement source.",
          "Official source revisions can matter more than a visually smooth forecast curve.",
        ],
      },
      {
        heading: "What PolyWeather surfaces",
        body:
          "The terminal separates source labels, observation timestamps, forecast models, and freshness state so a user can audit the path to a number.",
        bullets: [
          "Settlement-source labels and station context on charts.",
          "Source freshness, cache policy, and SSE patch visibility.",
          "DEB forecast context shown next to live observations, not as a replacement for them.",
        ],
      },
    ],
  },
];

export const SOURCE_PAGES: SourcePage[] = [
  {
    slug: "mgm",
    title: "MGM Weather Source",
    description:
      "PolyWeather source note for Turkish MGM observations used in Ankara-style temperature market analysis.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "Turkish State Meteorological Service",
    coverage: "Turkey official station network, including Ankara market context.",
    cadence: "Source cadence varies by station and publication path; terminal freshness checks are required.",
    settlementUse:
      "Used as the primary official-source family when Ankara markets reference Turkish official observations.",
    reliabilityNotes: [
      "Single-point spikes should be compared with neighboring timestamps before being accepted.",
      "Official summaries can lag raw point observations.",
      "Cache and SSE replay state should be checked when a value appears suddenly.",
    ],
    relatedMethodologySlugs: ["settlement-sources", "deb"],
  },
  {
    slug: "metar",
    title: "METAR Airport Observations",
    description:
      "PolyWeather source note for airport METAR observations used as fast evidence in temperature-market workflows.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "Airport weather observation network",
    coverage: "Airport-linked observations across supported markets.",
    cadence: "Often hourly or sub-hourly depending on airport and issuance behavior.",
    settlementUse:
      "Useful for fast evidence and airport-linked contracts; must be reconciled with the contract's exact settlement source.",
    reliabilityNotes: [
      "METAR can update faster than official daily summaries.",
      "Airport exposure may differ from city-center official stations.",
      "Late METAR cycles can change high-temperature judgment near market close.",
    ],
    relatedMethodologySlugs: ["settlement-sources", "deb"],
  },
  {
    slug: "ecmwf",
    title: "ECMWF Model Guidance",
    description:
      "PolyWeather source note for ECMWF model guidance as one input into DEB blended forecasts.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "European Centre for Medium-Range Weather Forecasts",
    coverage: "Global numerical weather prediction guidance.",
    cadence: "Model-run cadence depends on product and ingestion timing.",
    settlementUse:
      "Used for forecast context only. It does not replace live official observations for settlement interpretation.",
    reliabilityNotes: [
      "Model warmth or coolness should be validated against live observations.",
      "Run-to-run shifts can be useful when source evidence has not yet settled.",
      "Model spread should be shown beside, not above, settlement-source data.",
    ],
    relatedMethodologySlugs: ["deb"],
  },
  {
    slug: "hko",
    title: "HKO Official Observations",
    description:
      "PolyWeather source note for Hong Kong Observatory observations in Hong Kong market analysis.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "Hong Kong Observatory",
    coverage: "Hong Kong official observation network and station-specific context.",
    cadence: "Cadence varies by observation product; terminal freshness checks remain required.",
    settlementUse:
      "Used as the official-source family for Hong Kong station and city-market interpretation.",
    reliabilityNotes: [
      "Station selection can materially change the maximum-temperature read.",
      "Airport observations should be separated from broader HKO network readings.",
      "Humidity, wind, and late-day sun breaks can affect final highs.",
    ],
    relatedMethodologySlugs: ["settlement-sources", "deb"],
  },
  {
    slug: "noaa",
    title: "NOAA Weather Context",
    description:
      "PolyWeather source note for NOAA context used to validate US weather-market observations and summaries.",
    updatedAt: "2026-06-24T00:00:00Z",
    operator: "National Oceanic and Atmospheric Administration",
    coverage: "United States official weather observations, summaries, and context products.",
    cadence: "Cadence depends on product family and station reporting behavior.",
    settlementUse:
      "Used to audit and contextualize US official observations where contract rules reference NOAA/NWS data.",
    reliabilityNotes: [
      "Official summaries can arrive after fast airport observations.",
      "Daily high interpretation should match the contract's station and time zone rules.",
      "Use NOAA context to confirm whether an airport observation is representative.",
    ],
    relatedMethodologySlugs: ["settlement-sources", "deb"],
  },
];

export function briefPath(brief: PublicBrief) {
  return `/briefs/${brief.city}/${brief.date}`;
}

export function methodologyPath(page: MethodologyPage) {
  return `/methodology/${page.slug}`;
}

export function sourcePath(page: SourcePage) {
  return `/sources/${page.slug}`;
}

export function getBrief(city: string, date: string) {
  return PUBLIC_BRIEFS.find((brief) => brief.city === city && brief.date === date);
}

export function getMethodologyPage(slug: string) {
  return METHODOLOGY_PAGES.find((page) => page.slug === slug);
}

export function getSourcePage(slug: string) {
  return SOURCE_PAGES.find((page) => page.slug === slug);
}

export function absolutePublicUrl(pathname: string) {
  return `${PUBLIC_CONTENT_BASE_URL}${pathname}`;
}
