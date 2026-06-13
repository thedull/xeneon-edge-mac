import { test, expect, _electron as electron } from '@playwright/test';

// Electron shell smoke test. Skipped automatically where a GUI Electron run is
// undesirable (set XEM_SKIP_ELECTRON=1). Uses its own port to avoid clashing
// with the Playwright dev webServer on :8787.
test.skip(!!process.env.XEM_SKIP_ELECTRON, 'electron smoke disabled');

test('boots, serves the API, and opens the kiosk window', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, XEM_PORT: '8799', XEM_FORCE_PRIMARY: '1' },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const health = await win.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:8799/api/health');
    return r.json();
  });
  expect(health.ok).toBe(true);
  expect(health.display.width).toBe(2560);
  expect(health.display.height).toBe(720);

  await expect.poll(() => win.title()).toContain('Xeneon');
  await app.close();
});
