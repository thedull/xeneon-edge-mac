// mse-player.js — 1080p DASH playback via MediaSource API.
//
// YouTube's 1080p streams are DASH (separate video + audio). We feed both
// into the same <video> element through two SourceBuffers. The server proxies
// the googlevideo URLs through /api/youtube/seg, which passes Range headers
// so we can seek by re-fetching at the right byte offset.
//
// Seeking works by:
//   1. Parsing the first 512 KB to isolate the init segment (ftyp+moov, which
//      precedes the first 'moof' box). The init segment is stored in memory.
//   2. On seek, flushing both SourceBuffers, re-appending the stored init
//      segments, then resuming fetch from an approximate byte offset.
//
// Codec strings are hardcoded for H.264 + AAC, which is what resolveDash()
// constrains yt-dlp to select.

const VIDEO_CODEC = 'video/mp4; codecs="avc1.640028"';
const AUDIO_CODEC = 'audio/mp4; codecs="mp4a.40.2"';
const INIT_FETCH  = 512 * 1024; // first fetch — must cover ftyp+moov
const CHUNK       = 2 * 1024 * 1024;
const MAX_ERRORS  = 6; // consecutive errors before giving up and calling onFatalError

export function isMseSupported() {
  try {
    return (
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported(VIDEO_CODEC) &&
      MediaSource.isTypeSupported(AUDIO_CODEC)
    );
  } catch {
    return false;
  }
}

// Walk top-level MP4 boxes to find the byte offset of the first 'moof' box.
// Everything before the first moof is the init segment (ftyp + moov).
function findMoofOffset(buffer) {
  const dv = new DataView(buffer);
  let off = 0;
  while (off + 8 <= buffer.byteLength) {
    const size = dv.getUint32(off);
    if (size < 8) break; // corrupt / end of parseable area
    const type =
      String.fromCharCode(dv.getUint8(off + 4)) +
      String.fromCharCode(dv.getUint8(off + 5)) +
      String.fromCharCode(dv.getUint8(off + 6)) +
      String.fromCharCode(dv.getUint8(off + 7));
    if (type === 'moof') return off;
    off += size;
  }
  return -1; // moof not found within this buffer
}

export class MsePlayer {
  constructor(videoEl, videoUrl, audioUrl) {
    this.el        = videoEl;
    this.videoUrl  = videoUrl;
    this.audioUrl  = audioUrl;
    this.ms        = null;
    this.vSb       = null;
    this.aSb       = null;
    // Per-track state
    this._v = { offset: 0, total: null, init: null, mediaStart: 0, done: false };
    this._a = { offset: 0, total: null, init: null, mediaStart: 0, done: false };
    this._gen      = 0;     // bumped on start/seek to cancel stale loops
    this._blobUrl  = null;
    this._destroyed = false;
    this._onSeek   = () => this._handleSeek();
    // Caller may set this to be notified of unrecoverable errors.
    this.onFatalError = null;
  }

  async start() {
    this.ms = new MediaSource();
    this._blobUrl = URL.createObjectURL(this.ms);
    this.el.src = this._blobUrl;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sourceopen timeout')), 10000);
      this.ms.addEventListener('sourceopen', () => { clearTimeout(t); resolve(); }, { once: true });
    });

    this.vSb = this.ms.addSourceBuffer(VIDEO_CODEC);
    this.aSb = this.ms.addSourceBuffer(AUDIO_CODEC);

    // Surface SourceBuffer errors to the fatal handler.
    const sbError = () => { if (!this._destroyed) this._fatal(); };
    this.vSb.addEventListener('error', sbError);
    this.aSb.addEventListener('error', sbError);

    this.el.addEventListener('seeking', this._onSeek);

    this._gen++;
    this._fetchLoop(this._v, this.vSb, this.videoUrl, this._gen);
    this._fetchLoop(this._a, this.aSb, this.audioUrl, this._gen);
  }

  // ── Core fetch loop ────────────────────────────────────────────────────────

  async _fetchLoop(t, sb, url, gen) {
    let errors = 0;
    while (!this._destroyed && gen === this._gen) {
      if (t.total !== null && t.offset >= t.total) {
        t.done = true;
        if (this._v.done && this._a.done) {
          try { if (this.ms.readyState === 'open') this.ms.endOfStream(); } catch { /* ok */ }
        }
        return;
      }

      const isInit  = t.init === null;          // first fetch — grab the init segment
      const start   = isInit ? 0 : t.offset;
      const fetchSz = isInit ? INIT_FETCH : CHUNK;
      const end     = t.total ? Math.min(start + fetchSz - 1, t.total - 1) : start + fetchSz - 1;

      let chunk;
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
        if (this._destroyed || gen !== this._gen) return;
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);

        // Learn total file size from the first response.
        if (t.total === null) {
          const cr = res.headers.get('content-range');
          if (cr) { const m = cr.match(/\/(\d+)$/); if (m) t.total = parseInt(m[1]); }
        }
        chunk = await res.arrayBuffer();
        errors = 0;
      } catch {
        if (this._destroyed || gen !== this._gen) return;
        if (++errors >= MAX_ERRORS) { this._fatal(); return; }
        await _sleep(1000 * errors);
        continue;
      }

      if (this._destroyed || gen !== this._gen) return;

      // On the very first fetch, split out the init segment (ftyp+moov).
      if (isInit) {
        const moofOff = findMoofOffset(chunk);
        if (moofOff > 0) {
          t.init        = chunk.slice(0, moofOff);
          t.mediaStart  = moofOff;
          t.offset      = moofOff; // next fetch starts at first moof
          chunk         = chunk;   // append the full first fetch (init + first fragment)
        } else {
          // Couldn't find moof — treat entire chunk as init, continue linearly.
          t.init        = chunk;
          t.mediaStart  = 0;
          t.offset      = chunk.byteLength;
        }
      } else {
        t.offset += chunk.byteLength;
      }

      // Append to SourceBuffer (wait for any in-progress update first).
      try {
        await _waitIdle(sb);
        if (this._destroyed || gen !== this._gen) return;
        sb.appendBuffer(chunk);
        await _waitIdle(sb);
      } catch {
        if (this._destroyed || gen !== this._gen) return;
        if (++errors >= MAX_ERRORS) { this._fatal(); return; }
        await _sleep(800);
      }
    }
  }

  // ── Seek ──────────────────────────────────────────────────────────────────

  async _handleSeek() {
    if (this._destroyed) return;
    const seekTime = this.el.currentTime;
    const duration = this.el.duration;
    if (!duration || isNaN(duration)) return;

    // Cancel all running fetch loops.
    this._gen++;
    const gen = this._gen;
    this._v.done = false;
    this._a.done = false;

    // Flush both SourceBuffers.
    for (const [t, sb] of [[this._v, this.vSb], [this._a, this.aSb]]) {
      try {
        await _waitIdle(sb);
        if (this._destroyed || gen !== this._gen) return;
        if (sb.buffered.length > 0) {
          sb.remove(0, Infinity);
          await _waitIdle(sb);
        }
        if (this._destroyed || gen !== this._gen) return;

        // Re-append the stored init segment so the browser can decode
        // fragments fetched from an arbitrary byte offset.
        if (t.init) {
          sb.appendBuffer(t.init);
          await _waitIdle(sb);
        }
        if (this._destroyed || gen !== this._gen) return;
      } catch {
        if (this._destroyed || gen !== this._gen) return;
      }

      // Calculate the approximate byte offset for the seek time.
      // We exclude the init segment from the ratio so seekByte is a media offset.
      if (t.total !== null && t.total > t.mediaStart) {
        const mediaBytes = t.total - t.mediaStart;
        const ratio      = Math.max(0, Math.min(1, seekTime / duration));
        const approx     = t.mediaStart + Math.floor(mediaBytes * ratio);
        // Align to a 64 KB boundary — fragments are typically larger, so this
        // usually lands us near a fragment start.
        const aligned    = Math.floor(approx / (64 * 1024)) * (64 * 1024);
        t.offset = Math.max(t.mediaStart, aligned);
      }
      // If we don't know the total yet, restart from mediaStart.
      else {
        t.offset = t.mediaStart;
      }
    }

    if (this._destroyed || gen !== this._gen) return;
    this._fetchLoop(this._v, this.vSb, this.videoUrl, gen);
    this._fetchLoop(this._a, this.aSb, this.audioUrl, gen);
  }

  // ── Fatal error ───────────────────────────────────────────────────────────

  _fatal() {
    if (this._destroyed) return;
    this.destroy();
    this.onFatalError?.();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    this._destroyed = true;
    this._gen++;
    this.el.removeEventListener('seeking', this._onSeek);
    try { if (this.ms?.readyState === 'open') this.ms.endOfStream(); } catch { /* ok */ }
    if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
    if (!this.el.src?.startsWith('blob:')) return;
    this.el.removeAttribute('src');
    this.el.load();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _waitIdle(sb) {
  if (!sb.updating) return Promise.resolve();
  return new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
