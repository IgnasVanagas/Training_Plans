const { defineConfig } = require("@playwright/test");

const baseURL = String(process.env.TP_INTEGRATION_BASE_URL || "http://127.0.0.1:3300").replace(/\/$/, "");

module.exports = defineConfig({
  testDir: "./integration",
  testMatch: /.*\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "integration-artifacts/playwright-report", open: "never" }],
  ],
  globalSetup: require.resolve("./integration/global-setup.js"),
  globalTeardown: require.resolve("./integration/global-teardown.js"),
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
});