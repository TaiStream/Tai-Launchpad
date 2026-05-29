import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this app so Next doesn't walk up and
  // auto-detect a lockfile elsewhere in the repo (e.g. the Rust workspace).
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    // Allow remote Display image_url's from common hosts.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  async redirects() {
    return [
      // The standalone hiring portal was merged into the agents directory.
      { source: "/hire", destination: "/agents", permanent: true },
    ];
  },
};

export default nextConfig;
