import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rewritePlaylist, proxySegment } from '../../src/server/collectors/youtube-hls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYLIST_URL = 'https://r1---sn-x.googlevideo.com/videoplayback/m3u8?id=xyz';
const enc = (u) => encodeURIComponent(u);

test('rewritePlaylist routes every media URI through /api/youtube/seg', async () => {
  const m3u8 = await readFile(path.join(here, '../fixtures/youtube-f95.m3u8'), 'utf8');
  const out = rewritePlaylist(m3u8, PLAYLIST_URL);

  // EXT-X-MAP and EXT-X-KEY URI="" attributes are rewritten (MAP is load-bearing).
  assert.ok(
    out.includes(`#EXT-X-MAP:URI="/api/youtube/seg?u=${enc('https://r1---sn-x.googlevideo.com/videoplayback/init.mp4?itag=95')}"`),
  );
  assert.ok(out.includes(`#EXT-X-KEY:METHOD=AES-128,URI="/api/youtube/seg?u=${enc('https://r1---sn-x.googlevideo.com/key?k=abc')}"`));

  // Absolute segment line.
  assert.ok(out.includes(`/api/youtube/seg?u=${enc('https://r1---sn-x.googlevideo.com/videoplayback/seg1.ts?range=0-100')}`));
  // Relative segment resolves against the playlist URL first.
  assert.ok(out.includes(`/api/youtube/seg?u=${enc('https://r1---sn-x.googlevideo.com/videoplayback/seg2.ts?range=101-200')}`));
  // Cross-host absolute segment.
  assert.ok(out.includes(`/api/youtube/seg?u=${enc('https://r2---sn-y.googlevideo.com/videoplayback/seg3.ts')}`));

  // Comments and BYTERANGE are left untouched; no raw googlevideo URL escapes.
  assert.ok(out.includes('#EXT-X-BYTERANGE:1000@0'));
  assert.ok(out.includes('#EXTINF:5.000,'));
  assert.ok(!/^https:\/\/r\d/m.test(out), 'no bare googlevideo URL should remain');
});

test('proxySegment SSRF guard rejects non-googlevideo hosts', async () => {
  const mk = () => {
    const res = { statusCode: 0, ended: false };
    res.writeHead = (code) => {
      res.statusCode = code;
      return res;
    };
    res.end = () => {
      res.ended = true;
      return res;
    };
    return res;
  };
  const req = { on() {} };

  for (const bad of ['https://evil.com/x', 'http://r1---sn-x.googlevideo.com/x', 'not a url']) {
    const res = mk();
    await proxySegment(bad, undefined, req, res);
    assert.equal(res.statusCode, 400, `should reject ${bad}`);
    assert.equal(res.ended, true);
  }
});
