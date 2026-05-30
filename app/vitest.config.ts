import { defineConfig } from "vitest/config";

export default defineConfig({
  // Provide an inline (empty) PostCSS config so Vite does NOT load the
  // project's postcss.config.mjs (whose Tailwind-v4 string-plugin form is for
  // Next/Turbopack and isn't a valid Vite PostCSS plugin). Node-env lib tests
  // need no CSS processing.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
