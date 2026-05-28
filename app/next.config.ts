import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next doesn't auto-detect the wrong lockfile
  // (the repo has a sibling landing/ project with its own lockfile).
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    // Allow remote Display image_url's from common hosts.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
