import { defineConfig } from '@playwright/test';
import { fixtureEnv } from './tests/fixtures/cognito.js';
export default defineConfig({
  testDir: './tests/browser', outputDir: 'test-results/browser', workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5175', channel: 'chrome', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175 --strictPort', url: 'http://127.0.0.1:5175', reuseExistingServer: false,
    env: { ...fixtureEnv, VITE_DISCOVERY_SOURCE: 'demo' } },
});
