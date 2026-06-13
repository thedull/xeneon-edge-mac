import { test, expect } from '@playwright/test';

test('renders area charts + headers from fixture data', async ({ page }) => {
  await page.goto('/widgets/system-monitor.html');
  await expect(page.locator('[data-widget="system"]')).toHaveAttribute('data-ready', 'true');

  // four metric charts, each with a canvas
  await expect(page.locator('.chart-card')).toHaveCount(4);
  await expect(page.locator('.chart-card canvas')).toHaveCount(4);

  // header values
  await expect(page.locator('[data-field="cpu"]')).toHaveText('34');
  await expect(page.locator('[data-field="disk"]')).toHaveText('74');
  await expect(page.locator('[data-field="ram"]')).toContainText('9.6'); // GB used
  await expect(page.locator('[data-field="ram"]')).toContainText('GB');
  await expect(page.locator('[data-field="down"]')).toHaveText('1.19 MB/s');
  await expect(page.locator('[data-field="up"]')).toHaveText('86 KB/s');

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
  await expect(page.locator('[data-field="disk"]')).toHaveText('74');
});
