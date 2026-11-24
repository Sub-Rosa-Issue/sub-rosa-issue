// Copyright (c) 2026 Sub Rosa contributors
import react from "@vitejs/plugin-react";
import inject from "@rollup/plugin-inject";
import { createRequire } from "node:module";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

export function resolveBuildSourcemap(
  mode: string,
  env: Record<string, string | undefined> = process.env,
): boolean | "hidden" {
  if (mode !== "production") return true;
  const value = env.WEB_BUILD_SOURCEMAP?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "hidden" ? "hidden" : false;
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      ...inject({
        process: "process/browser",
        Buffer: ["buffer", "Buffer"],
      }),
      enforce: "post",
    },
  ],
  resolve: {
    alias: {
      buffer: require.resolve("buffer/"),
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
      events: require.resolve("events/"),
      "node:crypto": require.resolve("crypto-browserify"),
      "node:buffer": require.resolve("buffer/"),
    },
  },
  define: {
    global: "globalThis",
    "process.env": "{}",
    "process.version": JSON.stringify("v22.0.0"),
  },
  optimizeDeps: {
    include: ["buffer", "crypto-browserify", "stream-browserify", "process/browser", "events"],
  },
  build: {
    sourcemap: resolveBuildSourcemap(mode),
  },
  server: {
    port: 5173,
    fs: {
      allow: ["..", "../..", "../../..", "../../../.."],
    },
  },
}));
