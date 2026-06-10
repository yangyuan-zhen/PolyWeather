/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async headers() {
    const immutableCacheHeader = {
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    };
    const immutableCloudflareCacheHeader = {
      key: "Cloudflare-CDN-Cache-Control",
      value: "public, max-age=31536000, immutable",
    };
    const publicPageHeaders = [
      {
        key: "Cache-Control",
        value: "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
      },
      {
        key: "Cloudflare-CDN-Cache-Control",
        value: "public, max-age=600, stale-while-revalidate=3600",
      },
    ];
    const staticExts = ["jpg", "jpeg", "png", "gif", "ico", "svg", "webp", "avif", "woff2", "ttf", "eot", "css", "js"];
    const staticAssetRules = staticExts.map((ext) => ({
      source: `/:path(.+\\.${ext})`,
      headers: [immutableCacheHeader, immutableCloudflareCacheHeader],
    }));
    const publicPageRules = [
      "/",
      "/docs/:path*",
      "/modern/:path*",
      "/probabilities/:path*",
      "/subscription-help/:path*",
    ].map((source) => ({
      source,
      headers: publicPageHeaders,
    }));
    return [...staticAssetRules, ...publicPageRules];
  },
};

export default nextConfig;
