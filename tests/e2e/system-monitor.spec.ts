import { test, expect } from '@playwright/test';

test('renders fixture system + network stats with bars', async ({ page }) => {
  await page.goto('/widgets/system-monitor.html');
  await expect(page.locator('[data-widget="system"]')).toHaveAttribute('data-ready', 'true');

  await expect(page.locator('[data-field="cpu"]')).toHaveText('34');
  await expect(page.locator('[data-field="ram"]')).toHaveText('61');
  await expect(page.locator('[data-field="disk"]')).toHaveText('74');
  await expect(page.locator('[data-field="ramDetail"]')).toContainText('GB');

  await expect(page.locator('[data-bar="cpu"]')).toHaveAttribute('style', /width:\s*34%/);
  await expect(page.locator('[data-bar="disk"]')).toHaveAttribute('style', /width:\s*74%/);

  await expect(page.locator('[data-field="down"]')).toHaveText('1.19 MB/s');
  await expect(page.locator('[data-field="up"]')).toHaveText('86 KB/s');
});

test('fills values from the SSE stream when the initial fetch is unavailable', async ({ page }) => {
  // Block the one-shot GET so only the SSE 'system' broadcast can populate the UI.
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
