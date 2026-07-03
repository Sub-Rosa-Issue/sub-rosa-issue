import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * jsdom provides browser-like globals (window, document, etc.)
     * required by WalletsKit's browser-environment checks.
     */
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    globals: false,
  },
});
