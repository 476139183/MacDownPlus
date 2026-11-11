import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    headless: true,
    trace: "retain-on-failure",
    launchOptions: { channel: process.env.CI ? "chromium" : "chrome" },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
    timeout: 15000,
  },
});
