import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results',
  use: {
    baseURL: 'http://127.0.0.1:3121',
    trace: 'retain-on-failure',
    locale: 'he-IL',
    // Every test context starts as an adult who passed the 18+ gate on this device (premium2.spec tests the gate itself).
    storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:3121', localStorage: [{ name: 't21:age-ok', value: '1' }] }] },
  },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    cwd: '../..',
    url: 'http://127.0.0.1:3121/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
