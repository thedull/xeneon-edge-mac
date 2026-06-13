// Shared exec + fixture seam for collectors.
//
// When XEM_FIXTURES=1, collectors return canned snapshots (and parsers can read
// captured text) from tests/fixtures/ instead of touching the live OS. This is
// what makes /api/* responses and the rendered widgets deterministic for E2E.
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execAsync = promisify(exec);
const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(here, '../../../tests/fixtures');

export const USE_FIXTURES = process.env.XEM_FIXTURES === '1';

// Run a shell command and return stdout (trimmed of nothing — parsers handle whitespace).
export async function sh(command, { timeout = 5000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const { stdout } = await execAsync(command, { timeout, maxBuffer });
  return stdout;
}

// Raw text source: fixture file when XEM_FIXTURES=1, else the live command output.
export async function source(fixtureName, realFn) {
  if (USE_FIXTURES) return readFile(path.join(FIXTURE_DIR, fixtureName), 'utf8');
  return realFn();
}

// Load a canned JSON snapshot fixture (used to make a whole /api/* response deterministic).
export async function fixtureJson(name) {
  const raw = await readFile(path.join(FIXTURE_DIR, name), 'utf8');
  return JSON.parse(raw);
}

export function now() {
  return Date.now();
}

// Human-readable bytes/sec.
export function humanRate(bytesPerSec) {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = Math.max(0, bytesPerSec);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}
