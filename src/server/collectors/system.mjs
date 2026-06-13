// System collector: CPU%, RAM%, Disk% — macOS-native, no third-party deps.
//   CPU%  : os.cpus() idle/total delta between samples (whole-machine, 0-100).
//   RAM%  : os.totalmem()/os.freemem().
//   Disk% : `df -k /` Capacity column.
import os from 'node:os';
import { sh, source, USE_FIXTURES, fixtureJson, now } from './_exec.mjs';

// ---- pure parsers (unit-tested against fixtures) ----

// `df -k /` → integer percent used of the root volume.
export function parseDfCapacity(raw) {
  const lines = raw.trim().split('\n');
  if (lines.length < 2) return null;
  // Data row is the last non-empty line; Capacity is the column ending in '%'.
  const dataLine = lines[lines.length - 1].trim();
  const cols = dataLine.split(/\s+/);
  const pctCol = cols.find((c) => /^\d+%$/.test(c));
  if (!pctCol) return null;
  return Number.parseInt(pctCol, 10);
}

// Aggregate os.cpus() times into { idle, total }.
export function cpuTimes(cpus = os.cpus()) {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

// CPU% from two cumulative samples.
export function cpuPercentFromSamples(a, b) {
  const idleDiff = b.idle - a.idle;
  const totalDiff = b.total - a.total;
  if (totalDiff <= 0) return 0;
  const pct = (1 - idleDiff / totalDiff) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

// `vm_stat` → page counts + page size. os.freemem() is useless on macOS (it
// excludes cached/compressed pages and reads ~99% used), so we go to vm_stat.
export function parseVmStat(raw) {
  const header = raw.split('\n', 1)[0] || '';
  const psMatch = header.match(/page size of (\d+) bytes/);
  const pageSize = psMatch ? Number.parseInt(psMatch[1], 10) : 4096;
  const get = (label) => {
    const m = raw.match(new RegExp(`^${label}:\\s+(\\d+)\\.`, 'm'));
    return m ? Number.parseInt(m[1], 10) : 0;
  };
  return {
    pageSize,
    free: get('Pages free'),
    active: get('Pages active'),
    inactive: get('Pages inactive'),
    speculative: get('Pages speculative'),
    wired: get('Pages wired down'),
    compressed: get('Pages occupied by compressor'),
    anonymous: get('Anonymous pages'),
    fileBacked: get('File-backed pages'),
    purgeable: get('Pages purgeable'),
  };
}

// "Memory Used" as Activity Monitor reports it: App Memory (anonymous) + Wired +
// Compressed. File-backed/cached and free pages are not counted as used.
export function memUsedBytes(vm) {
  return (vm.anonymous + vm.wired + vm.compressed) * vm.pageSize;
}

// ---- live collection ----

let prevSample = cpuTimes();

async function ramSnapshot() {
  const total = os.totalmem();
  let used;
  try {
    const raw = await source('vmstat.txt', () => sh('vm_stat'));
    used = memUsedBytes(parseVmStat(raw));
  } catch {
    used = total - os.freemem(); // last-resort fallback
  }
  return {
    ram: Math.round((used / total) * 1000) / 10,
    ramUsedMB: Math.round(used / 1024 / 1024),
    ramTotalMB: Math.round(total / 1024 / 1024),
  };
}

async function diskPercent() {
  try {
    const raw = await source('df.txt', () => sh('df -k /'));
    return parseDfCapacity(raw);
  } catch {
    return null;
  }
}

export async function collect() {
  if (USE_FIXTURES) {
    const snap = await fixtureJson('system.json');
    return { ...snap, ts: now() };
  }
  const sample = cpuTimes();
  const cpu = cpuPercentFromSamples(prevSample, sample);
  prevSample = sample;
  const ram = await ramSnapshot();
  const disk = await diskPercent();
  return {
    cpu,
    ...ram,
    disk,
    cpuTemp: null,
    gpuTemp: null,
    topProcesses: [],
    source: 'mac-native',
    ts: now(),
  };
}
