import { defineConfig } from '@playwright/test';

// E2E runs against the standalone server with XEM_FIXTURES=1 so every /api/*
// response (and therefore every widget) is deterministic — no live load, no
// network, no Music.app. Widgets render at the true 2560x720 Edge resolution.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'on-first-retry',
    viewport: { width: 2560, height: 720 },
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
    env: { XEM_FIXTURES: '1', XEM_PORT: '8787' },
  },
});
