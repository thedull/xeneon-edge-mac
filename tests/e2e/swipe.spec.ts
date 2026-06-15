import { test, expect } from '@playwright/test';

// A horizontal swipe that starts inside a widget iframe must change the page:
// the iframe can't bubble pointer events to the stage, so swipe-nav.js forwards
// the intent via postMessage and grid.js navigates.
test('horizontal swipe inside a widget iframe changes the page', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => window.__grid && window.__grid.pageCount > 1);
  expect(await page.evaluate(() => window.__grid.index)).toBe(0);

  const frame = page.frameLocator('iframe[title="processes"]');
  await frame.locator('body').waitFor();

  const swipe = (fromX: number, toX: number, fromY: number, toY: number) =>
    frame.locator(':root').evaluate((_el, p) => {
      const fire = (type: string, x: number, y: number) =>
        document.dispatchEvent(
          new PointerEvent(type, { clientX: x, clientY: y, isPrimary: true, bubbles: true }),
        );
      fire('pointerdown', p.fromX, p.fromY);
      fire('pointerup', p.toX, p.toY);
    }, { fromX, toX, fromY, toY });

  // Swipe left → next page.
  await swipe(400, 100, 150, 150);
  await expect.poll(() => page.evaluate(() => window.__grid.index)).toBe(1);

  // Swipe right → back to page 0.
  await swipe(100, 400, 150, 150);
  await expect.poll(() => page.evaluate(() => window.__grid.index)).toBe(0);

  // A vertical drag must NOT change the page.
  await swipe(150, 160, 100, 400);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__grid.index)).toBe(0);
});
