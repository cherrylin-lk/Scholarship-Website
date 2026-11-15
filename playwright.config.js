import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'chrome', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI,
    env: { VITE_DISCOVERY_SOURCE: 'demo' } },
});
