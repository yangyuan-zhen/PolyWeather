/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async headers() {
    const cacheHeader = {
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    };
    const staticExts = ["jpg", "jpeg", "png", "gif", "ico", "svg", "webp", "avif", "woff2", "ttf", "eot", "css", "js"];
    return staticExts.map((ext) => ({
      source: `/:path(.+\\.${ext})`,
      headers: [cacheHeader],
    }));
  },
};

export default nextConfig;
