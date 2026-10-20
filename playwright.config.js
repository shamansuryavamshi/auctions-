// Playwright config for the auction browser suite.
// workers: 1 — the auction is one authoritative server-side state machine,
// so browser specs must run sequentially against it.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: 'http://127.0.0.1:4100',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node e2e/server.js',
    url: 'http://127.0.0.1:4100/api/health',
    timeout: 90000,
    reuseExistingServer: false,
  },
});
