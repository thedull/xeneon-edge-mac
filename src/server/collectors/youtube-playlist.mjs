// Extract a YouTube playlist's video list via yt-dlp (no API key needed).
// Uses --flat-playlist -J to get a single JSON dump without downloading anything.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ytdlpPath } from './youtube-stream.mjs';

const execFileAsync = promisify(execFile);

const ALLOWED_HOSTS = /^(www\.)?youtube\.com$/;

export async function fetchPlaylist(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('invalid url'); }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.test(parsed.hostname)) {
    throw new Error('only youtube.com playlist URLs are supported');
  }

  const { stdout } = await execFileAsync(
    ytdlpPath(),
    ['--flat-playlist', '-J', '--no-warnings', rawUrl],
    { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
  );

  let data;
  try { data = JSON.parse(stdout); } catch { throw new Error('could not parse playlist'); }

  const entries = data?.entries || [];
  const items = entries
    .filter((e) => e?.id)
    .map((e) => {
      const thumbs = Array.isArray(e.thumbnails) ? e.thumbnails : [];
      const thumb =
        e.thumbnail ||
        (thumbs.length ? thumbs[thumbs.length - 1].url : '') ||
        `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`;
      return {
        id: e.id,
        title: e.title || e.id,
        channel: e.uploader || e.channel || '',
        thumb,
      };
    });

  return { title: data?.title || 'Playlist', items };
}
