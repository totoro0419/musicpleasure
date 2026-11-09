import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "unit/**/*.test.ts"], environment: "node" },
});
