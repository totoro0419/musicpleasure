import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 45000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4173/musicpleasure/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "android-phone", use: { ...devices["Pixel 7"] } },
    { name: "android-tablet", use: { ...devices["Galaxy Tab S4"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --port 4173",
        url: "http://127.0.0.1:4173/musicpleasure/",
        reuseExistingServer: !process.env.CI,
      },
});
