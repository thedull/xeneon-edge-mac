// Network collector: down/up throughput (bytes/sec) from `netstat -ib`, diffing
// cumulative byte counters between successive reads.
import { sh, source, USE_FIXTURES, fixtureJson, now, humanRate } from './_exec.mjs';

// ---- pure parser (unit-tested against fixtures) ----

// `netstat -ib` → cumulative { ibytes, obytes } for the named interface.
// Each interface appears on several rows (one per address family) with the SAME
// cumulative counters; prefer the <Link#> row, else the first matching row, to
// avoid double counting.
export function parseNetstat(raw, iface = 'en0') {
  const lines = raw.trim().split('\n');
  if (lines.length < 2) return null;
  const header = lines[0].trim().split(/\s+/);
  const ibIdx = header.indexOf('Ibytes');
  const obIdx = header.indexOf('Obytes');
  if (ibIdx === -1 || obIdx === -1) return null;

  let chosen = null;
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== iface) continue;
    const isLink = cols.some((c) => c.startsWith('<Link#'));
    if (isLink) {
      chosen = cols;
      break;
    }
    if (!chosen) chosen = cols;
  }
  if (!chosen) return null;
  const ibytes = Number.parseInt(chosen[ibIdx], 10);
  const obytes = Number.parseInt(chosen[obIdx], 10);
  if (Number.isNaN(ibytes) || Number.isNaN(obytes)) return null;
  return { ibytes, obytes };
}

// Pick the primary active interface (the default route's interface), default en0.
async function primaryIface() {
  try {
    const raw = await sh('route -n get default 2>/dev/null');
    const m = raw.match(/interface:\s*(\S+)/);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  return 'en0';
}

// ---- live collection ----

let prev = null; // { ibytes, obytes, ts }
let iface = 'en0';
let ifaceResolved = false;

export async function collect() {
  if (USE_FIXTURES) {
    const snap = await fixtureJson('network.json');
    return { ...snap, ts: now() };
  }
  if (!ifaceResolved) {
    iface = await primaryIface();
    ifaceResolved = true;
  }
  let counters = null;
  try {
    const raw = await source('netstat.txt', () => sh('netstat -ib'));
    counters = parseNetstat(raw, iface) || parseNetstat(raw, 'en0');
  } catch {
    counters = null;
  }
  const ts = now();
  let download = 0;
  let upload = 0;
  if (counters && prev) {
    const dt = (ts - prev.ts) / 1000;
    if (dt > 0) {
      // Guard against counter resets (negative deltas).
      download = Math.max(0, (counters.ibytes - prev.ibytes) / dt);
      upload = Math.max(0, (counters.obytes - prev.obytes) / dt);
    }
  }
  if (counters) prev = { ...counters, ts };
  return {
    download: Math.round(download),
    upload: Math.round(upload),
    downloadHuman: humanRate(download),
    uploadHuman: humanRate(upload),
    iface,
    source: 'mac-native',
    ts,
  };
}
