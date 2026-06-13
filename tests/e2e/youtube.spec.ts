import { test, expect } from '@playwright/test';

// Keyless search now goes through the host's /api/youtube/search. Stub it and
// block the IFrame Player API script so the widget is fully offline/deterministic.
async function stubYouTube(page, items = DEFAULT_ITEMS) {
  await page.route('**/api/youtube/search**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items, source: 'youtube-scrape', ts: Date.now() }),
    }),
  );
  await page.route('**/iframe_api', (route) => route.abort());
}

const DEFAULT_ITEMS = [
  { id: 'abc123', title: 'Test Song', channel: 'Test Channel', thumb: 'about:blank', duration: '3:45' },
  { id: 'def456', title: 'Another Track', channel: 'Chan2', thumb: 'about:blank', duration: '4:01' },
];

test('search panel: keyboard input → results → tap-to-play (no API key)', async ({ page }) => {
  await stubYouTube(page);
  await page.goto('/widgets/youtube.html');

  await page.locator('[data-action="toggle-search"]').click();
  await expect(page.locator('[data-field="searchPanel"]')).toHaveClass(/open/);

  for (const ch of ['l', 'o', 'f', 'i']) {
    await page.locator(`.osk-key[data-key="${ch}"]`).click();
  }
  await expect(page.locator('[data-field="q"]')).toHaveValue('lofi');

  await page.locator('.osk-key[data-key="enter"]').click();
  await expect(page.locator('.yt-result')).toHaveCount(2);
  await expect(page.locator('.yt-result').first()).toContainText('Test Song');

  await page.locator('.yt-result').first().click();
  await expect.poll(() => page.evaluate(() => window.__yt.lastLoaded)).toBe('abc123');
  await expect(page.locator('[data-field="searchPanel"]')).not.toHaveClass(/open/);
});

test('shows a no-results message when search returns nothing', async ({ page }) => {
  await stubYouTube(page, []);
  await page.goto('/widgets/youtube.html');
  await page.locator('[data-action="toggle-search"]').click();
  await page.locator('[data-field="q"]').fill('zzzz');
  await page.locator('.osk-key[data-key="enter"]').click();
  await expect(page.locator('[data-field="results"]')).toContainText('No results');
});

test('shows the not-embeddable error state', async ({ page }) => {
  await stubYouTube(page);
  await page.goto('/widgets/youtube.html');
  await expect(page.locator('[data-field="error"]')).toBeHidden();
  await page.evaluate(() => window.__yt.simulateError());
  await expect(page.locator('[data-field="error"]')).toBeVisible();
});
