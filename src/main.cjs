// main.cjs — Electron host shell. Starts the local server, opens a kiosk window
// on the Xeneon Edge (or a 2560x720 window on the primary display as fallback),
// and re-targets the Edge on hotplug.
const { app, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const { resolveTarget, displayInfo } = require('./display.cjs');

const FORCE_PRIMARY =
  process.env.XEM_FORCE_PRIMARY === '1' || process.argv.includes('--kiosk-primary');

let serverHandle = null;
let win = null;
let currentTarget = null;

async function startBackend() {
  // server.mjs is ESM; load it from this CJS entry via dynamic import.
  const { startServer } = await import('./server/server.mjs');
  serverHandle = await startServer({
    port: Number(process.env.XEM_PORT || 8787),
    getDisplayInfo: () => displayInfo(currentTarget),
  });
  return serverHandle;
}

function createWindow(target, baseUrl) {
  const b = target.bounds;
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    fullscreen: target.found, // true OS-fullscreen only on the real Edge
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Pass the API origin so widgets (and child iframes) resolve the same server.
  win.loadURL(`${baseUrl}/dashboard.html?api=${encodeURIComponent(baseUrl)}`);
  win.on('closed', () => {
    win = null;
  });
}

function retarget(baseUrl) {
  const next = resolveTarget({ forcePrimary: FORCE_PRIMARY });
  currentTarget = next;
  if (win) {
    win.setFullScreen(false);
    win.setBounds(next.bounds);
    if (next.found) win.setFullScreen(true);
  } else {
    createWindow(next, baseUrl);
  }
}

app.whenReady().then(async () => {
  currentTarget = resolveTarget({ forcePrimary: FORCE_PRIMARY });
  const handle = await startBackend();
  // eslint-disable-next-line no-console
  console.log(`[xem] server ${handle.url} — display:`, displayInfo(currentTarget));
  createWindow(currentTarget, handle.url);

  screen.on('display-added', () => retarget(handle.url));
  screen.on('display-removed', () => retarget(handle.url));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(currentTarget, handle.url);
  });
});

app.on('window-all-closed', async () => {
  if (serverHandle) await serverHandle.stop().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});
