import { test, expect } from '@playwright/test';

test('renders Apple Music now-playing from fixtures', async ({ page }) => {
  await page.goto('/widgets/media-player.html');
  await expect(page.locator('[data-widget="media"]')).toHaveAttribute('data-ready', 'true');

  await expect(page.locator('[data-field="title"]')).toHaveText('Redbone');
  await expect(page.locator('[data-field="artist"]')).toHaveText('Childish Gambino');
  await expect(page.locator('[data-field="volume"]')).toHaveValue('62');
  await expect(page.locator('[data-field="dur"]')).toHaveText('5:26');
  await expect(page.locator('[data-field="progress"]')).toHaveAttribute('style', /width:\s*\d/);
});

test('transport + volume controls issue the right requests', async ({ page }) => {
  // Return a paused snapshot so we can assert the play/pause icon flips.
  await page.route('**/api/media/playpause', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        playerState: 'paused',
        title: 'Redbone',
        artist: 'Childish Gambino',
        artworkId: '12345',
        positionSec: 73.4,
        durationSec: 326,
        volume: 62,
        source: 'apple-music',
        ts: Date.now(),
      }),
    }),
  );

  await page.goto('/widgets/media-player.html');
  await expect(page.locator('[data-field="title"]')).toHaveText('Redbone');

  const [playReq] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/media/playpause') && r.method() === 'POST'),
    page.locator('[data-action="playpause"]').click(),
  ]);
  expect(playReq).toBeTruthy();
  await expect(page.locator('[data-field="playicon"]')).toHaveText('▶'); // ▶ when paused

  const [volReq] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/media/volume') && r.method() === 'POST'),
    page.locator('[data-field="volume"]').fill('30'),
  ]);
  expect(volReq.postDataJSON()).toEqual({ volume: 30 });
});

test('shows the empty state when nothing is playing', async ({ page }) => {
  await page.route('**/api/media', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ available: false, playerState: 'stopped', reason: 'Nothing playing', source: 'apple-music', ts: Date.now() }),
    }),
  );
  // Block SSE so the fixture 'media' broadcast can't overwrite our unavailable state.
  await page.route('**/events', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/widgets/media-player.html');
  await expect(page.locator('[data-field="empty"]')).toBeVisible();
  await expect(page.locator('[data-field="player"]')).toBeHidden();
});
