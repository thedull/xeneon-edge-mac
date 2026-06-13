// Unit tests for the fragile OS-output parsers — the highest-value guard against
// macOS command format drift. Run with: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseDfCapacity,
  cpuPercentFromSamples,
  parseVmStat,
  memUsedBytes,
} from '../../src/server/collectors/system.mjs';
import { parseNetstat } from '../../src/server/collectors/network.mjs';
import { parsePs, topByCpu } from '../../src/server/collectors/processes.mjs';
import { parseMusicOutput } from '../../src/server/collectors/media.mjs';
import { normalizeUsage } from '../../src/server/collectors/ai-usage.mjs';
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

test('humanRate formats byte rates', () => {
  assert.equal(humanRate(0), '0 B/s');
  assert.equal(humanRate(1024), '1.00 KB/s');
  assert.equal(humanRate(1248300), '1.19 MB/s');
});
