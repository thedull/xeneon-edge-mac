import { test, expect } from '@playwright/test';

test('renders area charts + headers from fixture data', async ({ page }) => {
  await page.goto('/widgets/system-monitor.html');
  await expect(page.locator('[data-widget="system"]')).toHaveAttribute('data-ready', 'true');

  // three metric charts (CPU, Memory, Disk — network is its own widget now)
  await expect(page.locator('.chart-card')).toHaveCount(3);
  await expect(page.locator('.chart-card canvas')).toHaveCount(3);

  // header values
  await expect(page.locator('[data-field="cpu"]')).toHaveText('34');
  await expect(page.locator('[data-field="diskTotal"]')).toHaveText('921 GB'); // gauge shows % in center
  await expect(page.locator('[data-field="ram"]')).toContainText('9.6'); // GB used
  await expect(page.locator('[data-field="ram"]')).toContainText('GB');

  // charts received data (probe hook)
  const probe = await page.evaluate(() => window.__system);
  expect(probe.cpu).toBe(34);
  expect(probe.disk).toBe(74);
  expect(probe.samples).toBeGreaterThan(0);
});

test('fills values from the SSE stream when the initial fetch is unavailable', async ({ page }) => {
  await page.route('**/api/system', (route) => route.abort());
  await page.goto('/widgets/system-monitor.html');
  await expect(page.locator('[data-field="cpu"]')).toHaveText('34', { timeout: 8000 });
});

test('still renders when SSE is down (polling fallback)', async ({ page }) => {
  await page.route('**/events', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/widgets/system-monitor.html');
  await expect(page.locator('[data-field="cpu"]')).toHaveText('34', { timeout: 8000 });
  await expect(page.locator('[data-field="diskTotal"]')).toHaveText('921 GB');
});
