// Unit tests for the fragile OS-output parsers — the highest-value guard against
// macOS command format drift. Run with: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseDfCapacity,
  parseDfTotalGB,
  cpuPercentFromSamples,
  parseVmStat,
  memUsedBytes,
} from '../../src/server/collectors/system.mjs';
import { parseNetstat } from '../../src/server/collectors/network.mjs';
import { parsePs, topByCpu, topByMem } from '../../src/server/collectors/processes.mjs';
import { gaugeColor, gaugeMetrics } from '../../web/js/chart.js';
import { parseMusicOutput } from '../../src/server/collectors/media.mjs';
import { normalizeUsage } from '../../src/server/collectors/ai-usage.mjs';
import { parseYouTubeResults } from '../../src/server/collectors/youtube.mjs';
import { isEdgeDisplay, findEdgeDisplay } from '../../src/display-match.cjs';
import { humanRate } from '../../src/server/collectors/_exec.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, '../fixtures', name), 'utf8');

test('parseDfCapacity reads the Capacity column', () => {
  assert.equal(parseDfCapacity(fixture('df.txt')), 74);
});

test('cpuPercentFromSamples computes busy fraction', () => {
  const a = { idle: 1000, total: 2000 };
  const b = { idle: 1200, total: 2400 }; // 200 idle of 400 total → 50% busy
  assert.equal(cpuPercentFromSamples(a, b), 50);
  assert.equal(cpuPercentFromSamples(a, a), 0); // no elapsed time
});

test('parseVmStat + memUsedBytes compute Activity-Monitor-style used memory', () => {
  const vm = parseVmStat(fixture('vmstat.txt'));
  assert.equal(vm.pageSize, 16384);
  assert.equal(vm.wired, 120000);
  assert.equal(vm.compressed, 60000); // "occupied by compressor", not "stored in"
  assert.equal(vm.anonymous, 380000);
  // used = (anonymous + wired + compressed) * pageSize
  assert.equal(memUsedBytes(vm), 560000 * 16384);
  assert.equal(Math.round(memUsedBytes(vm) / 1024 / 1024), 8750); // MB
});

test('parseNetstat picks the <Link#> row and reads byte counters', () => {
  const r = parseNetstat(fixture('netstat.txt'), 'en0');
  assert.deepEqual(r, { ibytes: 123456789, obytes: 987654321 });
});

test('parsePs parses rows and basenames; topByCpu sorts desc', () => {
  const totalMem = 16 * 1024 * 1024 * 1024;
  const rows = parsePs(fixture('ps.txt'), totalMem);
  assert.equal(rows.length, 5);
  const chrome = rows[0];
  assert.equal(chrome.pid, 4821);
  assert.equal(chrome.user, 'gabbytee');
  assert.equal(chrome.cpu, 18.2);
  assert.equal(chrome.name, 'Google Chrome'); // basename of a spaced path
  assert.equal(chrome.memMB, 1196); // 7.3% of 16 GiB

  const top = topByCpu(rows, 3);
  assert.equal(top.length, 3);
  assert.deepEqual(
    top.map((p) => p.pid),
    [4821, 512, 1200],
  );
});

test('parseMusicOutput parses delimited now-playing output', () => {
  const d = parseMusicOutput(fixture('music-read.txt'));
  assert.equal(d.available, true);
  assert.equal(d.playerState, 'playing');
  assert.equal(d.title, 'Redbone');
  assert.equal(d.artist, 'Childish Gambino');
  assert.equal(d.album, 'Awaken, My Love!');
  assert.equal(d.artworkId, '12345');
  assert.equal(d.positionSec, 73.4);
  assert.equal(d.durationSec, 326);
  assert.equal(d.volume, 62);
});

test('parseMusicOutput handles not-running / stopped sentinels', () => {
  assert.equal(parseMusicOutput('NOTRUNNING').available, false);
  assert.equal(parseMusicOutput('STOPPED').available, false);
  assert.equal(parseMusicOutput('').available, false);
});

test('normalizeUsage maps alternate field names and totals spend', () => {
  const out = normalizeUsage({
    providers: [
      { name: 'claude', cost: 4.1, inputTokens: 100, outputTokens: 20, requestCount: 7 },
      { provider: 'openrouter', spendUSD: 1.9, tokensIn: 50, tokensOut: 10, requests: 3 },
    ],
  });
  assert.equal(out.available, true);
  assert.equal(out.providers[0].provider, 'claude');
  assert.equal(out.providers[0].spendUSD, 4.1);
  assert.equal(out.providers[0].tokensIn, 100);
  assert.equal(out.providers[1].provider, 'openrouter');
  assert.equal(out.totalSpendUSD, 6); // 4.1 + 1.9
});

test('parseYouTubeResults scrapes videoRenderers from ytInitialData', () => {
  const items = parseYouTubeResults(fixture('youtube-results.html'));
  assert.equal(items.length, 2); // promotedVideoRenderer ignored
  assert.deepEqual(items[0], {
    id: 'abc123',
    title: 'Test Song',
    channel: 'Test Channel',
    thumb: 'thumb-large', // last (largest) thumbnail
    duration: '3:45',
  });
  assert.equal(items[1].id, 'def456');
  assert.equal(items[1].channel, 'Chan2'); // longBylineText fallback
});

test('parseYouTubeResults is safe on garbage input', () => {
  assert.deepEqual(parseYouTubeResults('<html>no data here</html>'), []);
});

test('isEdgeDisplay matches the Edge by points, native pixels, and aspect', () => {
  // exact in points
  assert.equal(isEdgeDisplay({ size: { width: 2560, height: 720 }, scaleFactor: 1 }), true);
  // native pixels via HiDPI scaleFactor 2 (1280x360 points)
  assert.equal(isEdgeDisplay({ size: { width: 1280, height: 360 }, scaleFactor: 2 }), true);
  // aspect-ratio fallback (slightly off resolution, external)
  assert.equal(isEdgeDisplay({ size: { width: 2552, height: 718 }, scaleFactor: 1, internal: false }), true);
  // a normal laptop display is NOT the Edge
  assert.equal(isEdgeDisplay({ size: { width: 1512, height: 982 }, scaleFactor: 2, internal: true }), false);

  // findEdgeDisplay prefers the exact match among several displays
  const laptop = { id: 1, size: { width: 1512, height: 982 }, scaleFactor: 2, internal: true };
  const edge = { id: 2, size: { width: 2560, height: 720 }, scaleFactor: 1, internal: false };
  assert.equal(findEdgeDisplay([laptop, edge]).id, 2);
  assert.equal(findEdgeDisplay([laptop]), null);
});

test('humanRate formats byte rates', () => {
  assert.equal(humanRate(0), '0 B/s');
  assert.equal(humanRate(1024), '1.00 KB/s');
  assert.equal(humanRate(1248300), '1.19 MB/s');
});

test('parseDfTotalGB reads the root volume size from the 1024-blocks column', () => {
  assert.equal(parseDfTotalGB(fixture('df.txt')), 921);
  assert.equal(parseDfTotalGB('only one line'), null);
});

test('topByMem sorts by memory percent desc (tie-broken by cpu)', () => {
  const rows = parsePs(fixture('ps.txt'));
  const byMem = topByMem(rows, 3);
  for (let i = 1; i < byMem.length; i += 1) {
    assert.ok(byMem[i - 1].memPercent >= byMem[i].memPercent);
  }
  // Electron (12.5%) is the heaviest in the fixture, ahead of Chrome (7.3%).
  assert.equal(byMem[0].name, 'Electron');
  // ...whereas topByCpu still leads with Chrome (18.2%).
  assert.equal(topByCpu(rows, 1)[0].name, 'Google Chrome');
});

test('gaugeMetrics keeps the 270° arc + stroke inside the canvas (no clipping)', () => {
  // a range of card sizes the disk gauge actually gets rendered at
  for (const [w, h] of [
    [390, 280],
    [240, 200],
    [600, 180],
    [180, 320],
  ]) {
    const { r, lw, cx, cy } = gaugeMetrics(w, h);
    const half = lw / 2;
    const sin135 = Math.sin((135 * Math.PI) / 180); // ≈ 0.707, the lowest drawn point
    // top (12-o'clock), bottom endpoints, and the horizontal extremes all fit
    assert.ok(cy - r - half >= -0.01, `top fits for ${w}x${h}`);
    assert.ok(cy + r * sin135 + half <= h + 0.01, `bottom fits for ${w}x${h}`);
    assert.ok(cx - r - half >= -0.01, `left fits for ${w}x${h}`);
    assert.ok(cx + r + half <= w + 0.01, `right fits for ${w}x${h}`);
  }
});

test('gaugeColor maps disk usage to threshold colors (boundaries exclusive)', () => {
  assert.equal(gaugeColor(95), '#ff4d6d'); // > 90 → red
  assert.equal(gaugeColor(90), '#ffd166'); // exactly 90 → not red, yellow
  assert.equal(gaugeColor(80), '#ffd166'); // > 75 → yellow
  assert.equal(gaugeColor(75), '#57e08e'); // exactly 75 → not yellow, green
  assert.equal(gaugeColor(60), '#57e08e'); // > 50 → green
  assert.equal(gaugeColor(50), '#5bc8ff'); // exactly 50 → not green, blue
  assert.equal(gaugeColor(5), '#5bc8ff'); // low → blue
});
