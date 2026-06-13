import { test, expect } from '@playwright/test';

test('renders provider cards + total from fixtures', async ({ page }) => {
  await page.goto('/widgets/ai-usage.html');
  await expect(page.locator('[data-widget="ai-usage"]')).toHaveAttribute('data-ready', 'true');

  await expect(page.locator('[data-field="total"]')).toHaveText('$5.19');
  await expect(page.locator('.provider')).toHaveCount(2);
  await expect(page.locator('.provider[data-provider="claude"] .spend')).toHaveText('$4.12');
  await expect(page.locator('.provider[data-provider="openrouter"] .spend')).toHaveText('$1.07');
  await expect(page.locator('.provider[data-provider="claude"]')).toContainText('req');
});

test('shows a banner when the monitor is unavailable', async ({ page }) => {
  await page.route('**/api/ai-usage', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        available: false,
        reason: 'ai-usage-monitor unreachable on :3456',
        providers: [],
        totalSpendUSD: 0,
        source: 'ai-usage-monitor',
        ts: Date.now(),
      }),
    }),
  );
  await page.route('**/events', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/widgets/ai-usage.html');
  await expect(page.locator('[data-field="banner"]')).toBeVisible();
  await expect(page.locator('[data-field="banner"]')).toContainText('unreachable');
});
