// Resolve 1080p YouTube DASH streams (separate video + audio) via yt-dlp.
// 1080p on YouTube is DASH-only — no muxed HLS stream exists for most videos.
// YouTube increasingly serves AV1 (itag 399) or VP9 (itag 248) at 1080p,
// not H.264. We accept any format and return the itag so the client can pick
// the right MSE codec string.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ytdlpPath, ID_RE } from './youtube-stream.mjs';

const execFileAsync = promisify(execFile);

const cache = new Map(); // id -> { videoUrl, audioUrl, videoItag, audioItag, exp }
const TTL_MS = 50 * 60 * 1000;

// Prefer MP4 container (AV1 or H.264) + M4A audio, fall back to WebM/Opus,
// then anything. No codec restriction — let YouTube serve what it has.
const FORMAT =
  'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/' +
  'bestvideo[height<=1080][ext=webm]+bestaudio[ext=webm]/' +
  'bestvideo[height<=1080]+bestaudio';

function extractItag(url) {
  const m = url.match(/[?&]itag=(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

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
    videoUrl:   proxy(lines[0]),
    audioUrl:   proxy(lines[1]),
    videoItag:  extractItag(lines[0]),
    audioItag:  extractItag(lines[1]),
    exp: Date.now() + TTL_MS,
  };
  cache.set(id, result);
  return result;
}
