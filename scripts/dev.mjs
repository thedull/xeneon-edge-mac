// scripts/dev.mjs — run the local server standalone (no Electron) so widgets can
// be developed/opened in a browser and driven by Playwright.
import { startServer } from '../src/server/server.mjs';

const port = Number(process.env.XEM_PORT || 8787);
const handle = await startServer({
  port,
  getDisplayInfo: () => ({ found: false, forced: true, width: 2560, height: 720, id: 0 }),
});

// eslint-disable-next-line no-console
console.log(`[xem dev] server at ${handle.url}`);
// eslint-disable-next-line no-console
console.log(`[xem dev] open ${handle.url}/dashboard.html`);

process.on('SIGINT', async () => {
  await handle.stop();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await handle.stop();
  process.exit(0);
});
