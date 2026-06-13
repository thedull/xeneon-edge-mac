// Local HTTP + SSE server. Serves the host-agnostic widget pages from web/ and
// exposes the /api/* contract. The Electron kiosk window is just another client.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { handleApi } from './routes.mjs';
import { createSseHub } from './sse.mjs';
import { collect as collectSystem } from './collectors/system.mjs';
import { collect as collectNetwork } from './collectors/network.mjs';
import { collect as collectMedia } from './collectors/media.mjs';
import { collect as collectAiUsage } from './collectors/ai-usage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_ROOT = path.resolve(here, '../../web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

async function serveStatic(res, webRoot, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/dashboard.html';
  // Resolve and confine to webRoot (no path traversal).
  const filePath = path.join(webRoot, path.normalize(rel));
  if (!filePath.startsWith(webRoot)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) return serveStatic(res, webRoot, path.join(rel, 'index.html'));
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

// Poll collectors once, fan results out over SSE. One collection, many clients.
function startBackgroundCollectors(sse) {
  const timers = [];
  const safe = (fn, event) => async () => {
    try {
      sse.broadcast(event, await fn());
    } catch {
      /* skip a tick */
    }
  };
  timers.push(setInterval(safe(collectSystem, 'system'), 1000));
  timers.push(setInterval(safe(collectNetwork, 'network'), 1000));
  // XEM_DISABLE_MEDIA skips Apple Music polling (avoids the macOS Automation
  // prompt during headless dev / screenshots).
  if (process.env.XEM_DISABLE_MEDIA !== '1') {
    timers.push(setInterval(safe(collectMedia, 'media'), 3000));
  }
  timers.push(setInterval(safe(collectAiUsage, 'ai-usage'), 5000));
  timers.push(setInterval(() => sse.broadcast('ping', { ts: Date.now() }), 15000));
  for (const t of timers) t.unref?.();
  return () => timers.forEach(clearInterval);
}

export async function startServer({
  port = 8787,
  host = '127.0.0.1',
  webRoot = DEFAULT_WEB_ROOT,
  getDisplayInfo,
  enableCollectors = true,
} = {}) {
  const sse = createSseHub();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    const handled = await handleApi(req, res, url, { sse, getDisplayInfo });
    if (handled) return;
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('method not allowed');
      return;
    }
    await serveStatic(res, webRoot, url.pathname);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const stopCollectors = enableCollectors ? startBackgroundCollectors(sse) : () => {};
  const actualPort = server.address().port;
  const url = `http://${host}:${actualPort}`;

  async function stop() {
    stopCollectors();
    sse.closeAll();
    await new Promise((resolve) => server.close(resolve));
  }

  return { server, sse, port: actualPort, host, url, stop };
}
