import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/musicpleasure/",
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString()) },
  server: { allowedHosts: true },
});
