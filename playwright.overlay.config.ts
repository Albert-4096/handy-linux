import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "overlay.spec.ts",
  use: {
    baseURL: "http://localhost:1438",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
  webServer: {
    command: "bunx vite --port 1438",
    url: "http://localhost:1438",
    reuseExistingServer: false,
  },
});
