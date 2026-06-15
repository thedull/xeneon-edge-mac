import { test, expect } from '@playwright/test';

// Block YouTube's IFrame API so the nested youtube pane stays offline/deterministic.
test.beforeEach(async ({ page }) => {
  await page.route('**/iframe_api', (route) => route.abort());
});

test('tabbed player switches panes and persists the choice', async ({ page }) => {
  await page.goto('/widgets/player.html');
  await expect(page.locator('[data-widget="player"]')).toHaveAttribute('data-ready', 'true');

  // YouTube is the default active pane.
  await expect(page.locator('[data-pane="youtube"]')).toHaveClass(/active/);
  await expect(page.locator('[data-pane="media"]')).not.toHaveClass(/active/);
  await expect(page.locator('.player-seg[data-tab="youtube"]')).toHaveAttribute('aria-pressed', 'true');

  // Switch to Apple Music.
  await page.locator('.player-seg[data-tab="media"]').click();
  await expect(page.locator('[data-pane="media"]')).toHaveClass(/active/);
  await expect(page.locator('[data-pane="youtube"]')).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.__player.active)).toBe('media');

  // Choice persists across reload (localStorage via config.js).
  await page.reload();
  await expect(page.locator('[data-widget="player"]')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.evaluate(() => window.__player.active)).toBe('media');
});
