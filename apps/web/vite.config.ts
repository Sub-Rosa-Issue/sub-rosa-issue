// Copyright (c) 2026 Sub Rosa contributors
import react from "@vitejs/plugin-react";
import inject from "@rollup/plugin-inject";
import { createRequire } from "node:module";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { productionConnectSrc } from "./src/lib/csp";

const require = createRequire(import.meta.url);

export default defineConfig(({ command, mode }) => {
  const isProductionBuild = command === "build";
  const env = loadEnv(mode, process.cwd(), "");
  const plugins: Plugin[] = [
    react(),
    {
      ...inject({
        process: "process/browser",
        Buffer: ["buffer", "Buffer"],
      }),
      enforce: "post",
    },
  ];

  if (isProductionBuild) {
    const connectSrc = productionConnectSrc(env);
    plugins.push({
      name: "production-connect-src-csp",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return {
            html,
            tags: [{
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: `connect-src ${connectSrc};`,
              },
              injectTo: "head",
            }],
          };
        },
      },
    });
  }

  return {
    plugins,
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
    server: {
      port: 5173,
      fs: {
        allow: ["..", "../..", "../../..", "../../../.."],
      },
    },
  };
});
