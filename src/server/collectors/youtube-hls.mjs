// youtube-hls.mjs — 1080p YouTube playback via HLS (itag 96, audio+video muxed).
//
// hls.js can't fetch googlevideo's .m3u8/segments directly: those responses have
// no Access-Control-Allow-Origin, so the 127.0.0.1 page origin is blocked. We
// proxy both through the local server (same-origin → no CORS):
//   /api/youtube/hls?id=  → resolve the variant m3u8, rewrite every media URI to
//                           point at /api/youtube/seg, return the rewritten text.
//   /api/youtube/seg?u=   → stream the bytes from googlevideo (Range pass-through).
//
// Format preference: itag 96 (1080p HLS) → 95 (720p HLS) → 18 (360p progressive
// mp4). If the resolved URL isn't actually HLS we throw `not-hls` so the route
// 409s and the client uses the existing 360p /api/youtube/stream path.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { ytdlpPath, ID_RE } from './youtube-stream.mjs';

const execFileAsync = promisify(execFile);

// googlevideo URLs expire (~6h) and are IP-bound; cache the resolved m3u8 URL
// well inside that window so repeat plays / seeks skip the ~5s yt-dlp call.
const cache = new Map(); // id -> { url, exp }
const TTL_MS = 50 * 60 * 1000;

export async function resolveHlsUrl(id) {
  if (!ID_RE.test(id || '')) throw new Error('invalid video id');
  const hit = cache.get(id);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { stdout } = await execFileAsync(
    ytdlpPath(),
    ['-f', '96/95/18', '-g', '--no-playlist', '--no-warnings', `https://www.youtube.com/watch?v=${id}`],
    { timeout: 25000, maxBuffer: 1024 * 1024 },
  );
  const url = stdout.trim().split('\n')[0];
  if (!url.startsWith('http')) throw new Error('no stream url');
  cache.set(id, { url, exp: Date.now() + TTL_MS });
  return url;
}

// Rewrite every media/resource URI in an HLS media playlist to route through the
// same-origin segment proxy. Handles bare segment lines and URI="…" attributes
// (EXT-X-MAP/KEY/MEDIA/PART/…). BYTERANGE/comments are left as-is — the byte
// range is satisfied by the proxied segment's own Range request.
const URI_ATTR_RE = /URI="([^"]*)"/g;

export function rewritePlaylist(text, playlistUrl, segPath = '/api/youtube/seg') {
  const proxied = (raw) => `${segPath}?u=${encodeURIComponent(new URL(raw, playlistUrl).href)}`;
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        // Rewrite any URI="…" attribute (EXT-X-MAP is load-bearing for fMP4).
        return line.replace(URI_ATTR_RE, (_m, u) => `URI="${proxied(u)}"`);
      }
      // A bare line is a segment/sub-resource URI.
      return proxied(trimmed);
    })
    .join('\n');
}

// Resolve + fetch + rewrite. Throws `not-hls` when the resolved URL is the f18
// mp4 fallback (or an unexpected master playlist), so the caller 409s → 360p.
export async function hlsPlaylist(id) {
  const url = await resolveHlsUrl(id);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`upstream m3u8 HTTP ${res.status}`);
  const text = await res.text();
  if (!text.startsWith('#EXTM3U')) throw new Error('not-hls');
  // A master playlist's sub-playlists would arrive un-rewritten → CORS fail.
  if (text.includes('#EXT-X-STREAM-INF')) throw new Error('not-hls');
  return { body: rewritePlaylist(text, url), contentType: 'application/vnd.apple.mpegurl' };
}

// Stream a googlevideo segment to the client, mirroring Range/status so seeking
// works. SSRF-guarded to googlevideo/youtube hosts only.
export async function proxySegment(rawUrl, rangeHeader, req, res) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const host = target.hostname;
  if (target.protocol !== 'https:' || !/\.(googlevideo|youtube)\.com$/.test(host)) {
    res.writeHead(400).end();
    return;
  }

  const ac = new AbortController();
  const abort = () => ac.abort();
  req.on('close', abort);
  res.on('close', abort);

  const upstream = await fetch(target.href, {
    headers: rangeHeader ? { range: rangeHeader } : {},
    signal: ac.signal,
  });
  const headers = {
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  const len = upstream.headers.get('content-length');
  const range = upstream.headers.get('content-range');
  if (len) headers['Content-Length'] = len;
  if (range) headers['Content-Range'] = range;
  res.writeHead(upstream.status, headers); // mirror 200/206
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
  else res.end();
}
