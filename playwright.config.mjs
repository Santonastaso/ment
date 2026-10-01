import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts/browser',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3010',
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3010 --strictPort --configLoader runner',
    cwd: './client',
    url: 'http://127.0.0.1:3010',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'build_only_placeholder' },
  },
});
