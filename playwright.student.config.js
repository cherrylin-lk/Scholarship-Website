import { defineConfig } from '@playwright/test';
import { fixtureEnv } from './tests/fixtures/cognito.js';
export default defineConfig({
  testDir: './tests/student-browser', outputDir: 'test-results/student', workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5176', channel: 'chrome', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176', reuseExistingServer: false,
    env: { ...fixtureEnv, VITE_DISCOVERY_SOURCE: 'api', VITE_API_BASE_URL: 'http://127.0.0.1:5190', VITE_ACCOUNT_API_BASE_URL: 'http://127.0.0.1:5190' } },
});
