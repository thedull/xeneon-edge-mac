import { test, expect } from '@playwright/test';

test('renders the default 3-tile layout', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => !!window.__grid);

  const firstPage = page.locator('.page').first();
  await expect(firstPage.locator('.tile')).toHaveCount(3);
  await expect(firstPage.locator('.tile[data-widget="youtube"]')).toHaveCount(1);
  await expect(firstPage.locator('.tile[data-widget="system-monitor"]')).toHaveCount(1);
  await expect(firstPage.locator('.tile[data-widget="media-player"]')).toHaveCount(1);

  // default preset has two pages
  expect(await page.evaluate(() => window.__grid.pageCount)).toBe(2);
});

test('paginates and persists the current page across reload', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => !!window.__grid);
  expect(await page.evaluate(() => window.__grid.index)).toBe(0);

  await page.evaluate(() => window.__grid.next());
  await expect.poll(() => page.evaluate(() => window.__grid.index)).toBe(1);

  await page.reload();
  await page.waitForFunction(() => !!window.__grid);
  await expect.poll(() => page.evaluate(() => window.__grid.index)).toBe(1);
});
