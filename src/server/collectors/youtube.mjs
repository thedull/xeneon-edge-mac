// YouTube search WITHOUT an API key: fetch the public results page server-side
// (no CORS in the main process) and scrape `ytInitialData` for video renderers.
import { USE_FIXTURES, source } from './_exec.mjs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Pure parser (unit-tested): results-page HTML → [{id,title,channel,thumb,duration}].
export function parseYouTubeResults(html) {
  const m =
    html.match(/var ytInitialData\s*=\s*(\{.*?\});<\/script>/s) ||
    html.match(/ytInitialData"\]\s*=\s*(\{.*?\});/s);
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
      ?.contents || [];
  const out = [];
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const it of items) {
      const v = it?.videoRenderer;
      if (!v || !v.videoId) continue;
      const thumbs = v.thumbnail?.thumbnails || [];
      out.push({
        id: v.videoId,
        title: v.title?.runs?.[0]?.text || '',
        channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
        thumb: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        duration: v.lengthText?.simpleText || '',
      });
    }
  }
  return out.slice(0, 20);
}

export async function search(query) {
  if (USE_FIXTURES) {
    const html = await source('youtube-results.html', async () => '');
    return parseYouTubeResults(html);
  }
  // `sp=EgIQAQ%3D%3D` filters the results to videos only.
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    query,
  )}&sp=EgIQAQ%3D%3D`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
  return parseYouTubeResults(await res.text());
}
