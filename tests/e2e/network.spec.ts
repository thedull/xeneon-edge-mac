import { test, expect } from '@playwright/test';

test('renders the dual-line network chart from fixtures', async ({ page }) => {
  await page.goto('/widgets/network.html');
  await expect(page.locator('[data-widget="network"]')).toHaveAttribute('data-ready', 'true');

  await expect(page.locator('[data-field="down"]')).toHaveText('1.19 MB/s');
  await expect(page.locator('[data-field="up"]')).toHaveText('86 KB/s');
  await expect(page.locator('canvas')).toHaveCount(1);

  // both series received samples (download + upload)
  const probe = await page.evaluate(() => window.__network);
  expect(probe.down).toBe(1248300);
  expect(probe.up).toBe(88200);
});
