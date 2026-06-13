// Processes collector: top processes by CPU via `ps`.
import os from 'node:os';
import { sh, source, USE_FIXTURES, fixtureJson, now } from './_exec.mjs';

const TOTAL_MEM = os.totalmem();

// ---- pure parser (unit-tested against fixtures) ----

// `ps -axo pid=,user=,%cpu=,%mem=,comm=` → array of process rows.
// `comm` (last column) may contain spaces / a full path; everything after the
// 4th whitespace-delimited field is the command.
export function parsePs(raw, totalMem = TOTAL_MEM) {
  const out = [];
  for (const line of raw.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
    if (!m) continue;
    const [, pid, user, cpu, mem, comm] = m;
    const memPercent = Number.parseFloat(mem);
    out.push({
      pid: Number.parseInt(pid, 10),
      user,
      cpu: Number.parseFloat(cpu),
      memPercent,
      memMB: Math.round((memPercent / 100) * totalMem / 1024 / 1024),
      name: basename(comm),
    });
  }
  return out;
}

function basename(comm) {
  // Strip a leading path; keep the executable/app name.
  const parts = comm.split('/');
  return parts[parts.length - 1] || comm;
}

export function topByCpu(rows, limit = 10) {
  return [...rows]
    .sort((a, b) => b.cpu - a.cpu || b.memPercent - a.memPercent)
    .slice(0, limit);
}

// ---- live collection ----

export async function collect(limit = 10) {
  if (USE_FIXTURES) {
    const snap = await fixtureJson('processes.json');
    return { ...snap, processes: snap.processes.slice(0, limit), limit, ts: now() };
  }
  let processes = [];
  try {
    const raw = await source('ps.txt', () =>
      sh('ps -axo pid=,user=,%cpu=,%mem=,comm='),
    );
    processes = topByCpu(parsePs(raw), limit);
  } catch {
    processes = [];
  }
  return { processes, limit, source: 'mac-native', ts: now() };
}
