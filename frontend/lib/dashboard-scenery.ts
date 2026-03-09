export interface CityScenery {
  creditLabel: string;
  creditUrl: string;
  imageUrl: string;
}

const DEFAULT_SCENERY: CityScenery = {
  creditLabel: "Pexels / City scenery",
  creditUrl: "https://www.pexels.com/",
  imageUrl: "/scenery/city-default.jpg",
};

export const CITY_SCENERY: Record<string, CityScenery> = {
  ankara: {
    creditLabel: "Pexels / Ankara skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/ankara.jpg",
  },
  chicago: {
    creditLabel: "Pexels / Chicago skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/chicago.jpg",
  },
  london: {
    creditLabel: "Pexels / London skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/london.jpg",
  },
  lucknow: {
    creditLabel: "Pexels / Lucknow heritage",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/lucknow.jpg",
  },
  munich: {
    creditLabel: "Pexels / Munich streetscape",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/munich.jpg",
  },
  "new york": {
    creditLabel: "Pexels / New York skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/new-york.jpg",
  },
  "new york city": {
    creditLabel: "Pexels / New York skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/new-york.jpg",
  },
  paris: {
    creditLabel: "Pexels / Paris streetscape",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/paris.jpg",
  },
  seoul: {
    creditLabel: "Pexels / Seoul cityscape",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/seoul.jpg",
  },
  "sao paulo": {
    creditLabel: "Pexels / Sao Paulo skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/sao-paulo.jpg",
  },
  "são paulo": {
    creditLabel: "Pexels / Sao Paulo skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/sao-paulo.jpg",
  },
  "s茫o paulo": {
    creditLabel: "Pexels / Sao Paulo skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/sao-paulo.jpg",
  },
  toronto: {
    creditLabel: "Pexels / Toronto skyline",
    creditUrl: "https://www.pexels.com/",
    imageUrl: "/scenery/toronto.jpg",
  },
};

export function getCityScenery(cityName?: string | null) {
  if (!cityName) return null;
  return CITY_SCENERY[String(cityName).toLowerCase()] || DEFAULT_SCENERY;
}
