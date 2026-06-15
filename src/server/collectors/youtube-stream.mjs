// youtube-stream.mjs — resolve a directly-playable media URL for a YouTube video
// via yt-dlp, so the player can use a native <video> element. This sidesteps the
// embedded-IFrame "Video unavailable / Error 152" origin restriction entirely:
// the renderer streams the file straight from googlevideo, no embed involved.
//
// itag 18 (360p, audio+video muxed, progressive https) is the format Chromium
// can play without HLS/DASH. Higher resolutions are DASH-only (separate streams)
// and would need MSE — a later upgrade.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);
export const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Resolve the yt-dlp binary: explicit override → bundled sidecar → brew → PATH.
export function ytdlpPath() {
  const candidates = [
    process.env.XEM_YTDLP,
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || 'yt-dlp';
}

// googlevideo URLs are time-limited (~6h) and IP-bound; cache resolutions briefly
// so repeat plays / seeks don't re-run yt-dlp (~5s each).
const cache = new Map(); // id -> { url, exp }
const TTL_MS = 60 * 60 * 1000;

export async function resolveStream(id) {
  if (!ID_RE.test(id || '')) throw new Error('invalid video id');
  const hit = cache.get(id);
  if (hit && hit.exp > Date.now()) return hit.url;

  const { stdout } = await execFileAsync(
    ytdlpPath(),
    [
      '-f',
      '18/best[acodec!=none][vcodec!=none][ext=mp4]',
      '-g',
      '--no-playlist',
      '--no-warnings',
      `https://www.youtube.com/watch?v=${id}`,
    ],
    { timeout: 25000, maxBuffer: 1024 * 1024 },
  );

  const url = stdout.trim().split('\n')[0];
  if (!url.startsWith('http')) throw new Error('no stream url');
  cache.set(id, { url, exp: Date.now() + TTL_MS });
  return url;
}
