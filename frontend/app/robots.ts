import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/terminal/", "/account/", "/ops/", "/api/"],
      },
    ],
    sitemap: "https://polyweather.top/sitemap.xml",
  };
}
