import type { MetadataRoute } from "next";
import {
  METHODOLOGY_PAGES,
  PUBLIC_BRIEFS,
  SOURCE_PAGES,
} from "@/content/public-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://polyweather.top";
  const now = new Date();

  return [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/auth/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/briefs`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/methodology`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/sources`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    ...PUBLIC_BRIEFS.map((brief) => ({
      url: `${baseUrl}/briefs/${brief.city}/${brief.date}`,
      lastModified: new Date(brief.updatedAt),
      changeFrequency: "daily" as const,
      priority: 0.85,
    })),
    ...METHODOLOGY_PAGES.map((page) => ({
      url: `${baseUrl}/methodology/${page.slug}`,
      lastModified: new Date(page.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })),
    ...SOURCE_PAGES.map((source) => ({
      url: `${baseUrl}/sources/${source.slug}`,
      lastModified: new Date(source.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
