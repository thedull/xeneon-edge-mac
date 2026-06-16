// Resolve 1080p YouTube DASH streams (separate video + audio) via yt-dlp.
// 1080p on YouTube is DASH-only — no muxed HLS stream exists for most videos.
// Returns proxied URLs through /api/youtube/seg so the renderer can fetch
// them same-origin (bypassing CORS) with Range support for seeking.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ytdlpPath, ID_RE } from './youtube-stream.mjs';

const execFileAsync = promisify(execFile);

const cache = new Map(); // id -> { videoUrl, audioUrl, exp }
const TTL_MS = 50 * 60 * 1000;

// Constrain to H.264+AAC so the client can hardcode codec strings for MSE.
// Falls back through quality levels if the best isn't available.
const FORMAT =
  'bestvideo[height<=1080][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/' +
  'bestvideo[height<=720][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]';

export async function resolveDash(id) {
  if (!ID_RE.test(id || '')) throw new Error('invalid video id');
  const hit = cache.get(id);
  if (hit && hit.exp > Date.now()) return hit;

  const { stdout } = await execFileAsync(
    ytdlpPath(),
    ['-f', FORMAT, '-g', '--no-playlist', '--no-warnings', `https://www.youtube.com/watch?v=${id}`],
    { timeout: 25000, maxBuffer: 1024 * 1024 },
  );

  const lines = stdout.trim().split('\n').filter(Boolean);
  if (lines.length < 2) throw new Error('expected separate video+audio urls');

  const proxy = (u) => `/api/youtube/seg?u=${encodeURIComponent(u)}`;
  const result = {
    videoUrl: proxy(lines[0]),
    audioUrl: proxy(lines[1]),
    exp: Date.now() + TTL_MS,
  };
  cache.set(id, result);
  return result;
}
