import { test, expect } from '@playwright/test';

test('renders the default 3-tile layout', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => !!window.__grid);

  const firstPage = page.locator('.page').first();
  await expect(firstPage.locator('.tile')).toHaveCount(4);
  await expect(firstPage.locator('.tile[data-widget="player"]')).toHaveCount(1);
  await expect(firstPage.locator('.tile[data-widget="system-monitor"]')).toHaveCount(1);
  await expect(firstPage.locator('.tile[data-widget="processes"]')).toHaveCount(1);
  await expect(firstPage.locator('.tile[data-widget="network"]')).toHaveCount(1);

  // the player mounts inline (no extra iframe layer) → youtube is a direct child
  await expect(firstPage.locator('.tile[data-widget="player"] .player-pane[data-pane="youtube"]')).toHaveCount(1);

  // default preset has two pages, and no page dots (removed)
  expect(await page.evaluate(() => window.__grid.pageCount)).toBe(2);
  await expect(page.locator('.dots')).toHaveCount(0);
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
