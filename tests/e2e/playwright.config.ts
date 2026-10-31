import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results',
  use: { baseURL: 'http://127.0.0.1:3121', trace: 'retain-on-failure', locale: 'he-IL' },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    cwd: '../..',
    url: 'http://127.0.0.1:3121/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
