import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig(({ mode }) => ({
  root: "frontend",
  optimizeDeps: { include: ["@noble/hashes/sha2.js"] },
  base: loadEnv(mode, ".", "VITE_").VITE_BASE_PATH || "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "MusicPleasure",
        short_name: "MusicPleasure",
        description: "音楽に、もっと自由を。",
        lang: "ja",
        theme_color: "#101014",
        background_color: "#101014",
        display: "standalone",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 4000000,
      },
    }),
  ],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    allowedHosts: ["terminal.local"],
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
}));
