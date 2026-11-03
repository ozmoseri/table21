import { defineConfig } from '@playwright/test';
const PORT = Number(process.env.T21_E2E_PORT ?? 3122);
export default defineConfig({ testDir: '.', testMatch: /qa-t08b?\.spec\.ts/, timeout: 180_000, workers: 1, retries: 0, reporter: [['list']], outputDir: '../../test-results-qa', use: { baseURL: `http://127.0.0.1:${PORT}` } });
