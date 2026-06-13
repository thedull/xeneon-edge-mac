// Apple Music collector: now-playing + transport + system volume via AppleScript.
// AppleScript is the OS interface here, so this collector is the *least* changed
// in a future Rust/Tauri port (it stays a shell-out to `osascript`).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { USE_FIXTURES, fixtureJson, now } from './_exec.mjs';

const execFileAsync = promisify(execFile);
const SEP = ''; // ASCII unit separator — won't appear in track metadata.

async function osa(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  return stdout;
}

// One script returns everything we poll, separator-delimited.
const READ_SCRIPT = `
tell application "System Events"
  if not (exists process "Music") then return "NOTRUNNING"
end tell
tell application "Music"
  if player state is stopped then return "STOPPED"
  set sep to (ASCII character 31)
  set t to current track
  set info to (name of t) & sep & (artist of t) & sep & (album of t) & sep & (player position) & sep & (duration of t) & sep & (player state as text) & sep & (database ID of t)
end tell
set sysVol to output volume of (get volume settings)
return info & (ASCII character 31) & sysVol
`;

// ---- pure parser (unit-tested against fixtures) ----

// Parse READ_SCRIPT stdout → media snapshot (without `ts`).
export function parseMusicOutput(raw) {
  const s = (raw || '').trim();
  if (s === 'NOTRUNNING') {
    return { available: false, playerState: 'stopped', reason: 'Music.app not running' };
  }
  if (s === 'STOPPED' || s === '') {
    return { available: false, playerState: 'stopped', reason: 'nothing playing' };
  }
  const p = s.split(SEP);
  if (p.length < 8) {
    return { available: false, playerState: 'stopped', reason: 'unparseable output' };
  }
  const [title, artist, album, position, duration, state, dbid, sysVol] = p;
  return {
    available: true,
    playerState: normalizeState(state),
    title,
    artist,
    album,
    artworkId: dbid,
    positionSec: Math.max(0, Number.parseFloat(position) || 0),
    durationSec: Math.max(0, Number.parseFloat(duration) || 0),
    volume: clampVol(Number.parseInt(sysVol, 10)),
  };
}

function normalizeState(state) {
  const s = String(state).toLowerCase();
  if (s.includes('play')) return 'playing';
  if (s.includes('pause')) return 'paused';
  return 'stopped';
}

function clampVol(v) {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

// ---- live collection ----

export async function collect() {
  if (USE_FIXTURES) {
    const snap = await fixtureJson('media.json');
    return { ...snap, source: 'apple-music', ts: now() };
  }
  try {
    const raw = await osa(READ_SCRIPT);
    return { ...parseMusicOutput(raw), source: 'apple-music', ts: now() };
  } catch (err) {
    return {
      available: false,
      playerState: 'stopped',
      reason: `osascript failed: ${err.message}`,
      source: 'apple-music',
      ts: now(),
    };
  }
}

const COMMANDS = {
  playpause: 'tell application "Music" to playpause',
  next: 'tell application "Music" to next track',
  previous: 'tell application "Music" to previous track',
};

export async function command(action) {
  if (USE_FIXTURES) return collect();
  const script = COMMANDS[action];
  if (!script) throw new Error(`unknown media command: ${action}`);
  await osa(script);
  return collect();
}

export async function setVolume(volume) {
  const v = clampVol(Number.parseInt(volume, 10));
  if (USE_FIXTURES) return collect();
  await osa(`set volume output volume ${v}`);
  return collect();
}

// Stream the current track's artwork as raw bytes. Returns {buffer, contentType, id} or null.
export async function artwork() {
  if (USE_FIXTURES) {
    // 1x1 transparent PNG so the widget's <img> resolves in tests.
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    return { buffer, contentType: 'image/png', id: 'fixture' };
  }
  const tmp = path.join(os.tmpdir(), `xem-art-${process.pid}.bin`);
  const script = `
tell application "System Events"
  if not (exists process "Music") then return "NONE"
end tell
tell application "Music"
  if player state is stopped then return "NONE"
  try
    set artData to (get raw data of artwork 1 of current track)
  on error
    return "NONE"
  end try
end tell
set outFile to (open for access (POSIX file "${tmp}") with write permission)
try
  set eof outFile to 0
  write artData to outFile
  close access outFile
on error
  try
    close access outFile
  end try
  return "NONE"
end try
return "OK"
`;
  const result = (await osa(script)).trim();
  if (result !== 'OK') return null;
  try {
    const buffer = await readFile(tmp);
    await unlink(tmp).catch(() => {});
    return { buffer, contentType: sniffImageType(buffer), id: String(buffer.length) };
  } catch {
    return null;
  }
}

function sniffImageType(buf) {
  if (buf.length >= 2 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return 'image/jpeg';
}
