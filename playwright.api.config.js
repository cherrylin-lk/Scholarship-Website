import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/api-browser', outputDir: 'test-results/api', workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', channel: 'chrome', headless: true, trace: 'retain-on-failure' },
  webServer: [
    { command: `${process.env.PYTHON || 'python'} backend/local_server.py`, url: 'http://127.0.0.1:8000/health', reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
      env: { VITE_DISCOVERY_SOURCE: 'api', VITE_API_BASE_URL: 'http://127.0.0.1:8000' } },
  ],
});
