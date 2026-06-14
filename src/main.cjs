// main.cjs — Electron host shell. Starts the local server, opens a kiosk window
// on the Xeneon Edge (or a 2560x720 window on the primary display as fallback),
// and re-targets the Edge on hotplug.
const { app, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const { resolveTarget, displayInfo } = require('./display.cjs');

const FORCE_PRIMARY =
  process.env.XEM_FORCE_PRIMARY === '1' || process.argv.includes('--kiosk-primary');
// Kiosk = true fullscreen, no window chrome, no menu. Default = a normal framed
// window with the macOS traffic-light controls (movable / resizable).
const KIOSK = process.env.XEM_KIOSK === '1' || process.argv.includes('--kiosk');

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
    title: 'Xeneon Edge',
    frame: !KIOSK, // framed (traffic lights) by default; borderless in kiosk
    // Framed mode keeps the traffic-light controls but drops the title bar, so
    // the dashboard fills the full 2560x720 instead of losing ~28px (which made
    // scale.js letterbox the right edge). Kiosk is already chromeless.
    titleBarStyle: KIOSK ? 'default' : 'hiddenInset',
    resizable: true,
    fullscreenable: true,
    kiosk: KIOSK, // true fullscreen, no menu, in kiosk mode
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Let the embedded YouTube player autoplay the selected video.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // Pass the API origin so widgets (and child iframes) resolve the same server.
  // chrome=framed lets the dashboard reserve the top-left for the (now
  // title-bar-less) traffic-light controls. Kiosk has no chrome.
  const chrome = KIOSK ? '' : '&chrome=framed';
  win.loadURL(`${baseUrl}/dashboard.html?api=${encodeURIComponent(baseUrl)}${chrome}`);
  win.on('closed', () => {
    win = null;
  });
}

// Keep the window pinned to the Edge whenever displays change (hotplug, etc.).
function retarget(baseUrl) {
  const next = resolveTarget({ forcePrimary: FORCE_PRIMARY });
  currentTarget = next;
  if (!win) {
    createWindow(next, baseUrl);
    return;
  }
  if (KIOSK) {
    win.setKiosk(false);
    win.setBounds(next.bounds);
    win.setKiosk(true);
  } else {
    win.setBounds(next.bounds);
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
