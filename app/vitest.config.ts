import { defineConfig } from "vitest/config";

export default defineConfig({
  // Disable CSS processing to avoid Vite loading postcss.config.mjs for node tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  css: false as any,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
