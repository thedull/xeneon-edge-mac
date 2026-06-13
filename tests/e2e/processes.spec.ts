import { test, expect } from '@playwright/test';

test('renders the top-processes table from fixtures', async ({ page }) => {
  await page.goto('/widgets/processes.html');
  await expect(page.locator('[data-widget="processes"]')).toHaveAttribute('data-ready', 'true');

  const rows = page.locator('#rows .proc-row');
  await expect(rows).toHaveCount(5);

  const first = rows.first();
  await expect(first).toHaveAttribute('data-pid', '4821');
  await expect(first.locator('.name').first()).toHaveText('Google Chrome');
  await expect(first.locator('.num').first()).toHaveText('4821');
  await expect(first).toContainText('gabbytee');
  await expect(first).toContainText('18.2');
  await expect(first).toContainText('MB');
});
