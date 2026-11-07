import { defineConfig } from '@playwright/test';

const testPort = Number(process.env.PLAYWRIGHT_PORT || 3010);
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error('Invalid PLAYWRIGHT_PORT');
const testUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './scripts/browser',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: testUrl,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Paris',
    // CI retains only the workflow's sanitized outcome summary. Local fixture
    // debugging can retain diagnostics; never repoint this config at production.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: process.env.CI ? 'off' : 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${testPort} --strictPort --configLoader runner`,
    cwd: './client',
    url: testUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'build_only_placeholder' },
  },
});
