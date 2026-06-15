// API routing: maps /api/* + /events to the collectors. Pure logic, no Electron.
import { collect as collectSystem } from './collectors/system.mjs';
import { collect as collectNetwork } from './collectors/network.mjs';
import { collect as collectProcesses } from './collectors/processes.mjs';
import {
  collect as collectMedia,
  command as mediaCommand,
  setVolume as mediaSetVolume,
  seek as mediaSeek,
  artwork as mediaArtwork,
} from './collectors/media.mjs';
import { collect as collectAiUsage } from './collectors/ai-usage.mjs';
import { USE_FIXTURES } from './collectors/_exec.mjs';

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// Returns true if the request was handled here.
export async function handleApi(req, res, url, ctx = {}) {
  const { pathname } = url;
  const { sse, getDisplayInfo } = ctx;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  if (pathname === '/events') {
    if (sse) sse.add(req, res);
    else sendJson(res, 503, { error: 'sse unavailable' });
    return true;
  }

  if (!pathname.startsWith('/api/')) return false;

  try {
    switch (true) {
      case pathname === '/api/health': {
        const display = typeof getDisplayInfo === 'function' ? getDisplayInfo() : { found: false };
        return ok(
          res,
          {
            ok: true,
            ts: Date.now(),
            fixtures: USE_FIXTURES,
            capabilities: {
              system: true,
              network: true,
              processes: true,
              media: true,
              aiUsage: true,
            },
            display,
          },
        );
      }
      case pathname === '/api/system':
        return ok(res, await collectSystem());
      case pathname === '/api/network':
        return ok(res, await collectNetwork());
      case pathname === '/api/processes': {
        const limit = clampLimit(url.searchParams.get('limit'));
        const sort = url.searchParams.get('sort') === 'mem' ? 'mem' : 'cpu';
        return ok(res, await collectProcesses(limit, sort));
      }
      case pathname === '/api/media':
        return ok(res, await collectMedia());
      case pathname === '/api/media/artwork': {
        const art = await mediaArtwork();
        if (!art) {
          res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return true;
        }
        res.writeHead(200, {
          'Content-Type': art.contentType,
          'Access-Control-Allow-Origin': '*',
          ETag: `"${art.id}"`,
          'Cache-Control': 'no-cache',
        });
        res.end(art.buffer);
        return true;
      }
      case pathname === '/api/media/playpause' && req.method === 'POST':
        return ok(res, await mediaCommand('playpause'));
      case pathname === '/api/media/next' && req.method === 'POST':
        return ok(res, await mediaCommand('next'));
      case pathname === '/api/media/previous' && req.method === 'POST':
        return ok(res, await mediaCommand('previous'));
      case pathname === '/api/media/volume' && req.method === 'POST': {
        const body = await readBody(req);
        return ok(res, await mediaSetVolume(body.volume));
      }
      case pathname === '/api/media/seek' && req.method === 'POST': {
        const body = await readBody(req);
        return ok(res, await mediaSeek(body.positionSec));
      }
      case pathname === '/api/ai-usage':
        return ok(res, await collectAiUsage());
      case pathname === '/api/youtube/search': {
        const q = url.searchParams.get('q') || '';
        if (!q.trim()) return ok(res, { items: [], source: 'youtube-scrape', ts: Date.now() });
        const { search } = await import('./collectors/youtube.mjs');
        try {
          return ok(res, { items: await search(q), source: 'youtube-scrape', ts: Date.now() });
        } catch (err) {
          return ok(res, { items: [], error: err.message, source: 'youtube-scrape', ts: Date.now() });
        }
      }
      case pathname === '/api/youtube/stream': {
        const id = url.searchParams.get('id') || '';
        try {
          const { resolveStream } = await import('./collectors/youtube-stream.mjs');
          return ok(res, { id, url: await resolveStream(id), source: 'yt-dlp', ts: Date.now() });
        } catch (err) {
          return ok(res, { id, url: null, error: err.message, source: 'yt-dlp', ts: Date.now() });
        }
      }
      case pathname === '/api/youtube/hls': {
        const id = url.searchParams.get('id') || '';
        try {
          const { hlsPlaylist } = await import('./collectors/youtube-hls.mjs');
          const { body, contentType } = await hlsPlaylist(id);
          res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          });
          res.end(body);
        } catch (err) {
          // not-hls / unavailable → client falls back to the 360p direct stream.
          sendJson(res, 409, { id, error: err.message, fallback: '/api/youtube/stream' });
        }
        return true;
      }
      case pathname === '/api/youtube/seg': {
        const u = url.searchParams.get('u') || '';
        try {
          const { proxySegment } = await import('./collectors/youtube-hls.mjs');
          await proxySegment(u, req.headers.range, req, res);
        } catch (err) {
          if (!res.headersSent) sendJson(res, 502, { error: err.message });
        }
        return true;
      }
      case pathname === '/api/plugins': {
        const { listPlugins } = await import('./collectors/plugins.mjs');
        return ok(res, { plugins: await listPlugins(), ts: Date.now() });
      }
      case pathname === '/api/plugins/import' && req.method === 'POST': {
        try {
          const { importPlugin } = await import('./collectors/plugins.mjs');
          return ok(res, { plugin: await importPlugin(await readRawBody(req)) });
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return true;
        }
      }
      case pathname.startsWith('/api/plugins/') && req.method === 'DELETE': {
        const id = decodeURIComponent(pathname.slice('/api/plugins/'.length));
        try {
          const { deletePlugin } = await import('./collectors/plugins.mjs');
          return ok(res, await deletePlugin(id));
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return true;
        }
      }
      default:
        sendJson(res, 404, { error: `no route: ${req.method} ${pathname}` });
        return true;
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message });
    return true;
  }
}

function ok(res, obj) {
  sendJson(res, 200, obj);
  return true;
}

function clampLimit(v) {
  const n = Number.parseInt(v ?? '10', 10);
  if (Number.isNaN(n)) return 10;
  return Math.max(1, Math.min(100, n));
}
