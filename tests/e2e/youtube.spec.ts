import { test, expect } from '@playwright/test';

// Keep the widget fully offline: stub the Data API search and block the IFrame
// Player API script. The search panel + on-screen keyboard remain testable.
async function stubYouTube(page) {
  await page.route('**/youtube/v3/search**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { id: { videoId: 'abc123' }, snippet: { title: 'Test Song', channelTitle: 'Test Channel', thumbnails: { medium: { url: 'about:blank' } } } },
          { id: { videoId: 'def456' }, snippet: { title: 'Another Track', channelTitle: 'Chan2', thumbnails: { medium: { url: 'about:blank' } } } },
        ],
      }),
    }),
  );
  await page.route('**/iframe_api', (route) => route.abort());
}

test('search panel: keyboard input → results → tap-to-play', async ({ page }) => {
  await stubYouTube(page);
  await page.goto('/widgets/youtube.html?ytkey=TESTKEY');

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

test('shows the not-embeddable error state', async ({ page }) => {
  await stubYouTube(page);
  await page.goto('/widgets/youtube.html?ytkey=TESTKEY');
  await expect(page.locator('[data-field="error"]')).toBeHidden();
  await page.evaluate(() => window.__yt.simulateError());
  await expect(page.locator('[data-field="error"]')).toBeVisible();
});

test('prompts for an API key when none is configured', async ({ page }) => {
  await stubYouTube(page);
  await page.goto('/widgets/youtube.html'); // no ytkey
  await page.locator('[data-action="toggle-search"]').click();
  await page.locator('[data-field="q"]').fill('lofi');
  await page.locator('.osk-key[data-key="enter"]').click();
  await expect(page.locator('[data-field="results"]')).toContainText('API key');
});
