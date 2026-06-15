// main.cjs — Electron host shell. Starts the local server, opens a kiosk window
// on the Xeneon Edge (or a 2560x720 window on the primary display as fallback),
// and re-targets the Edge on hotplug.
const { app, BrowserWindow, screen, session } = require('electron');
const path = require('node:path');
const { resolveTarget, displayInfo, findEdgeDisplay } = require('./display.cjs');
const { createTouchDriver } = require('./touch.cjs');

const FORCE_PRIMARY =
  process.env.XEM_FORCE_PRIMARY === '1' || process.argv.includes('--kiosk-primary');
// Kiosk = true fullscreen, no window chrome, no menu. Default = a normal framed
// window with the macOS traffic-light controls (movable / resizable).
const KIOSK = process.env.XEM_KIOSK === '1' || process.argv.includes('--kiosk');

// On macOS the app stays alive after its window closes, so a second `npm start`
// would race the first for the window and crash on EADDRINUSE (port 8787). The
// single-instance lock makes the first instance win: a second launch focuses the
// existing window and exits. In dev, the `prestart` hook ends a prior instance
// first, so your newest code wins instead.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// YouTube tightened embedded playback: embeds from a localhost origin with an
// Electron User-Agent now fail with "Video unavailable / can't be embedded". Make
// requests to YouTube look like a normal Chrome browser embedding from youtube.com
// itself. This recovers videos blocked by origin/referrer (the common case); ones
// whose owners truly disabled embedding still need the yt-dlp fallback.
function hardenYoutubeEmbedding() {
  const CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const ytHost = /(^|\.)(youtube|youtube-nocookie|googlevideo|ytimg|ggpht)\.com$/i;
  const ses = session.defaultSession;
  ses.setUserAgent(CHROME_UA); // drop the "Electron" UA that embed/anti-bot checks flag
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    let host = '';
    try {
      host = new URL(details.url).hostname;
    } catch {
      /* non-URL request; leave headers untouched */
    }
    if (ytHost.test(host)) {
      details.requestHeaders['User-Agent'] = CHROME_UA;
      // Present the embed as if it lives on youtube.com itself.
      details.requestHeaders.Referer = 'https://www.youtube.com/';
      details.requestHeaders.Origin = 'https://www.youtube.com';
    }
    cb({ requestHeaders: details.requestHeaders });
  });
}

let serverHandle = null;
let win = null;
let currentTarget = null;

// Native touch driver: maps physical Xeneon Edge touches to real clicks on the
// Edge's display. Auto-detects the panel; we pass the matched display id so it
// maps onto the exact display Electron is using even in multi-monitor layouts.
const touchDriver = createTouchDriver({
  getEdgeDisplayId: () => {
    const edge = findEdgeDisplay();
    return edge ? edge.id : 0;
  },
});

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
    // Deliver the first tap to the dashboard even when another display's window
    // had focus — otherwise macOS swallows that click just to activate the
    // window, forcing a double-tap on the touchscreen.
    acceptFirstMouse: true,
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
  hardenYoutubeEmbedding();
  // Imported iCUE widgets need a WRITABLE install dir. In a packaged app the
  // bundle (app.asar) is read-only, so point at userData. Must be set before the
  // server module is imported (it reads XEM_PLUGINS_DIR at load).
  if (app.isPackaged && !process.env.XEM_PLUGINS_DIR) {
    process.env.XEM_PLUGINS_DIR = path.join(app.getPath('userData'), 'plugins', 'installed');
  }
  currentTarget = resolveTarget({ forcePrimary: FORCE_PRIMARY });
  const handle = await startBackend();
  // eslint-disable-next-line no-console
  console.log(`[xem] server ${handle.url} — display:`, displayInfo(currentTarget));
  createWindow(currentTarget, handle.url);
  touchDriver.start();

  screen.on('display-added', () => {
    retarget(handle.url);
    touchDriver.retarget();
  });
  screen.on('display-removed', () => {
    retarget(handle.url);
    touchDriver.retarget();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(currentTarget, handle.url);
  });
});

app.on('window-all-closed', async () => {
  touchDriver.stop();
  if (serverHandle) await serverHandle.stop().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

// Ensure the helper is killed even on hard quit (Cmd-Q without closing windows).
app.on('before-quit', () => touchDriver.stop());
