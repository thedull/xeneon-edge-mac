// mse-player.js — 1080p DASH playback via MediaSource API.
//
// YouTube's 1080p streams are DASH (separate video + audio, fragmented MP4 or
// WebM). We feed both into one <video> through two SourceBuffers. The server
// proxies the googlevideo URLs through /api/youtube/seg with Range support.
//
// DESIGN: each track is streamed CONTIGUOUSLY from byte 0 in order. We never
// start a fetch at an arbitrary offset — that was the source of the earlier
// seek corruption (a Range starting mid-`mdat` feeds the decoder garbage).
// Because the whole timeline is appended in stream order, the browser handles
// seeking natively: backward / within-buffered seeks are instant, and a seek
// past the buffered edge simply stalls until the sequential download catches
// up (fast over the localhost proxy). When a SourceBuffer hits its memory
// quota we evict already-played data and retry, so long videos stay bounded.
//
// Codec strings are passed in per-itag (see codecsForItags) so AV1 / VP9 /
// H.264 all work without the player needing to parse the container.

const CHUNK      = 2 * 1024 * 1024;
const MAX_ERRORS = 6;
const EVICT_KEEP = 10; // seconds of already-played data to keep on eviction

// YouTube DASH itag → MSE codec string. Container-agnostic: the SourceBuffer
// mime carries the container (mp4 vs webm) and the contiguous-append path
// works for both without any box parsing.
const VIDEO_CODECS = {
  // AV1 MP4
  399: 'video/mp4; codecs="av01.0.08M.08"', 398: 'video/mp4; codecs="av01.0.04M.08"',
  397: 'video/mp4; codecs="av01.0.04M.08"', 396: 'video/mp4; codecs="av01.0.02M.08"',
  395: 'video/mp4; codecs="av01.0.01M.08"', 394: 'video/mp4; codecs="av01.0.00M.08"',
  // VP9 WebM
  248: 'video/webm; codecs="vp9"', 247: 'video/webm; codecs="vp9"',
  244: 'video/webm; codecs="vp9"', 243: 'video/webm; codecs="vp9"',
  // H.264 MP4
  137: 'video/mp4; codecs="avc1.640028"', 136: 'video/mp4; codecs="avc1.4d401f"',
  135: 'video/mp4; codecs="avc1.4d401e"', 134: 'video/mp4; codecs="avc1.4d401e"',
};
const AUDIO_CODECS = {
  141: 'audio/mp4; codecs="mp4a.40.2"', 140: 'audio/mp4; codecs="mp4a.40.2"',
  139: 'audio/mp4; codecs="mp4a.40.2"',
  251: 'audio/webm; codecs="opus"', 250: 'audio/webm; codecs="opus"',
  249: 'audio/webm; codecs="opus"',
};

export function isMseSupported() {
  return typeof MediaSource !== 'undefined';
}

// Resolve codec strings for a pair of itags; null if unknown or unsupported.
export function codecsForItags(videoItag, audioItag) {
  const vc = VIDEO_CODECS[videoItag];
  const ac = AUDIO_CODECS[audioItag];
  if (!vc || !ac) return null;
  try {
    if (!MediaSource.isTypeSupported(vc) || !MediaSource.isTypeSupported(ac)) return null;
  } catch { return null; }
  return { videoCodec: vc, audioCodec: ac };
}

export class MsePlayer {
  constructor(videoEl, videoUrl, audioUrl, videoCodec, audioCodec) {
    this.el         = videoEl;
    this.videoCodec = videoCodec;
    this.audioCodec = audioCodec;
    this._v = { url: videoUrl, sb: null, offset: 0, total: null, done: false };
    this._a = { url: audioUrl, sb: null, offset: 0, total: null, done: false };
    this.ms         = null;
    this._blobUrl   = null;
    this._gen       = 0; // bumped on destroy to cancel in-flight loops
    this._destroyed = false;
    this.onFatalError = null; // caller sets this for unrecoverable errors
  }

  async start() {
    this.ms = new MediaSource();
    this._blobUrl = URL.createObjectURL(this.ms);
    this.el.src = this._blobUrl;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sourceopen timeout')), 10000);
      this.ms.addEventListener('sourceopen', () => { clearTimeout(t); resolve(); }, { once: true });
    });

    this._v.sb = this.ms.addSourceBuffer(this.videoCodec);
    this._a.sb = this.ms.addSourceBuffer(this.audioCodec);
    const onSbError = () => { if (!this._destroyed) this._fatal(); };
    this._v.sb.addEventListener('error', onSbError);
    this._a.sb.addEventListener('error', onSbError);

    this._gen++;
    this._pump(this._v, this._gen);
    this._pump(this._a, this._gen);
  }

  // Sequentially fetch a track from byte 0 and append each chunk in order.
  async _pump(t, gen) {
    let errors = 0;
    while (!this._destroyed && gen === this._gen) {
      if (t.total !== null && t.offset >= t.total) {
        t.done = true;
        if (this._v.done && this._a.done) {
          try { if (this.ms.readyState === 'open') this.ms.endOfStream(); } catch { /* ok */ }
        }
        return;
      }

      const end = t.total ? Math.min(t.offset + CHUNK - 1, t.total - 1) : t.offset + CHUNK - 1;
      let chunk;
      try {
        const res = await fetch(t.url, { headers: { Range: `bytes=${t.offset}-${end}` } });
        if (this._stale(gen)) return;
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        if (t.total === null) {
          const cr = res.headers.get('content-range');
          if (cr) { const m = cr.match(/\/(\d+)$/); if (m) t.total = parseInt(m[1], 10); }
        }
        chunk = await res.arrayBuffer();
        errors = 0;
      } catch {
        if (this._stale(gen)) return;
        if (++errors >= MAX_ERRORS) { this._fatal(); return; }
        await _sleep(800 * errors);
        continue;
      }

      const appended = await this._append(t, chunk, gen);
      if (appended === 'stale') return;
      if (appended === 'fatal') { this._fatal(); return; }
      t.offset += chunk.byteLength;
    }
  }

  // Append a chunk, evicting played-back data and retrying on quota overflow.
  async _append(t, chunk, gen) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await _waitIdle(t.sb);
        if (this._stale(gen)) return 'stale';
        t.sb.appendBuffer(chunk);
        await _waitIdle(t.sb);
        return 'ok';
      } catch (err) {
        if (this._stale(gen)) return 'stale';
        if (err && err.name === 'QuotaExceededError') {
          const keepFrom = Math.max(0, this.el.currentTime - EVICT_KEEP);
          try {
            if (t.sb.buffered.length && keepFrom > t.sb.buffered.start(0)) {
              t.sb.remove(t.sb.buffered.start(0), keepFrom);
              await _waitIdle(t.sb);
            } else {
              // Nothing evictable yet — let playback advance, then retry.
              await _sleep(500);
            }
          } catch { /* fall through to retry */ }
          continue;
        }
        return 'fatal';
      }
    }
    return 'fatal';
  }

  _stale(gen) { return this._destroyed || gen !== this._gen; }

  _fatal() {
    if (this._destroyed) return;
    this.destroy();
    this.onFatalError?.();
  }

  destroy() {
    this._destroyed = true;
    this._gen++;
    try { if (this.ms?.readyState === 'open') this.ms.endOfStream(); } catch { /* ok */ }
    if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
    if (this.el.src?.startsWith('blob:')) { this.el.removeAttribute('src'); this.el.load(); }
  }
}

function _waitIdle(sb) {
  if (!sb.updating) return Promise.resolve();
  return new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
}
function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
