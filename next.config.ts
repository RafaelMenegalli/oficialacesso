import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [
      // The VSL is the funnel entry point. Temporary (307) so the root can be
      // repointed later without browsers caching the redirect.
      { source: "/", destination: "/vsl", permanent: false },
    ];
  },
};

export default nextConfig;
