// Scrape YouTube's "Up Next" / related videos from the watch page, same
// keyless technique as youtube.mjs (parse ytInitialData server-side).
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const cache = new Map(); // id -> { items, exp }
const TTL_MS = 30 * 60 * 1000;

export function parseRelated(html) {
  const m =
    html.match(/var ytInitialData\s*=\s*(\{.*?\});<\/script>/s) ||
    html.match(/ytInitialData"\]\s*=\s*(\{.*?\});/s);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const results =
    data?.contents?.twoColumnWatchNextResults?.secondaryResults
      ?.secondaryResults?.results || [];
  const out = [];
  for (const item of results) {
    const v = item?.compactVideoRenderer;
    if (!v?.videoId) continue;
    const thumbs = v.thumbnail?.thumbnails || [];
    out.push({
      id: v.videoId,
      title: v.title?.simpleText || v.title?.runs?.[0]?.text || '',
      channel: v.longBylineText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '',
      thumb: thumbs.length ? thumbs[thumbs.length - 1].url : '',
    });
  }
  return out.slice(0, 15);
}

export async function relatedVideos(id) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('invalid video id');
  const hit = cache.get(id);
  if (hit && hit.exp > Date.now()) return hit.items;
  const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
  const items = parseRelated(await res.text());
  cache.set(id, { items, exp: Date.now() + TTL_MS });
  return items;
}
