import { defineConfig } from '@playwright/test';

// Parallel worktrees: each agent picks its own port and database (T21_E2E_PORT, T21_E2E_DATABASE_URL); default 3121.
const PORT = Number(process.env.T21_E2E_PORT ?? 3121);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    locale: 'he-IL',
    // Every test context starts as an adult who passed the 18+ gate on this device (premium2.spec tests the gate itself).
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 't21:age-ok', value: '1' }] }] },
  },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    cwd: '../..',
    url: `${BASE}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
