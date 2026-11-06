import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Tailwind runs through postcss.config.mjs. The production build uses
  // webpack (`next build --webpack`): Turbopack evaluates CSS loaders in a
  // separate Node process, which Hostinger's build environment kills.
  async redirects() {
    return [
      // The VSL is the funnel entry point. Temporary (307) so the root can be
      // repointed later without browsers caching the redirect.
      { source: "/", destination: "/vsl", permanent: false },
    ];
  },
};

export default nextConfig;
