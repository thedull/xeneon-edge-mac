// mse-player.js — 1080p DASH playback via MediaSource API.
//
// YouTube's 1080p streams are DASH (separate video + audio). We feed both
// into the same <video> element through two SourceBuffers. The server proxies
// the googlevideo URLs through /api/youtube/seg, which passes Range headers
// so we can seek by re-fetching at the right byte offset.
//
// Codec strings are hardcoded for H.264 + AAC, which is what resolveDash()
// constrains yt-dlp to select.

const VIDEO_CODEC = 'video/mp4; codecs="avc1.640028"';
const AUDIO_CODEC = 'audio/mp4; codecs="mp4a.40.2"';
const CHUNK = 2 * 1024 * 1024; // 2 MB per fetch

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

export class MsePlayer {
  constructor(videoEl, videoUrl, audioUrl) {
    this.el = videoEl;
    this.videoUrl = videoUrl;
    this.audioUrl = audioUrl;
    this.ms = null;
    this.vSb = null;
    this.aSb = null;
    this.vOffset = 0;
    this.aOffset = 0;
    this.vTotal = null;
    this.aTotal = null;
    this._gen = 0;        // incremented on start/seek to cancel stale loops
    this._blobUrl = null;
    this._destroyed = false;
    this._onSeek = () => this._handleSeek();
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

    this.el.addEventListener('seeking', this._onSeek);

    this._gen++;
    this._fetchLoop('v', this._gen);
    this._fetchLoop('a', this._gen);
  }

  async _fetchLoop(track, gen) {
    while (!this._destroyed && gen === this._gen) {
      const url   = track === 'v' ? this.videoUrl  : this.audioUrl;
      const sb    = track === 'v' ? this.vSb        : this.aSb;
      const total = track === 'v' ? this.vTotal     : this.aTotal;
      let offset  = track === 'v' ? this.vOffset    : this.aOffset;

      // Stop if we've fetched everything for this track.
      if (total !== null && offset >= total) {
        if (track === 'v') this._vDone = true; else this._aDone = true;
        if (this._vDone && this._aDone) {
          try { if (this.ms.readyState === 'open') this.ms.endOfStream(); } catch { /* ok */ }
        }
        return;
      }

      const end = Math.min(offset + CHUNK - 1, total !== null ? total - 1 : Infinity);
      let chunk;
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` } });
        if (this._destroyed || gen !== this._gen) return;
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);

        // Learn total size from the first 206 response.
        const cr = res.headers.get('content-range');
        if (cr) {
          const m = cr.match(/\/(\d+)$/);
          if (m) {
            const size = parseInt(m[1]);
            if (track === 'v' && this.vTotal === null) this.vTotal = size;
            if (track === 'a' && this.aTotal === null) this.aTotal = size;
          }
        }

        chunk = await res.arrayBuffer();
      } catch {
        if (this._destroyed || gen !== this._gen) return;
        await new Promise((r) => setTimeout(r, 1500)); // back off on error
        continue;
      }

      if (this._destroyed || gen !== this._gen) return;

      // Wait for the SourceBuffer to finish any pending update.
      if (sb.updating) {
        await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
      }
      if (this._destroyed || gen !== this._gen) return;

      try {
        sb.appendBuffer(chunk);
        await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
      } catch {
        if (this._destroyed || gen !== this._gen) return;
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      if (track === 'v') this.vOffset += chunk.byteLength;
      else this.aOffset += chunk.byteLength;
    }
  }

  async _handleSeek() {
    if (this._destroyed) return;
    const seekTime = this.el.currentTime;
    const duration = this.el.duration;
    if (!duration || isNaN(duration)) return;

    // Bump generation to cancel in-flight fetch loops.
    this._gen++;
    const gen = this._gen;
    this._vDone = false;
    this._aDone = false;

    // Flush both SourceBuffers then restart from the seek position.
    for (const [sb, track] of [[this.vSb, 'v'], [this.aSb, 'a']]) {
      try {
        if (sb.updating) {
          await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
        }
        if (this._destroyed || gen !== this._gen) return;
        if (sb.buffered.length > 0) {
          sb.remove(0, Infinity);
          await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
        }
      } catch { /* ignore */ }

      const total = track === 'v' ? this.vTotal : this.aTotal;
      const ratio = seekTime / duration;
      // Align to 64 KB so we land on a sane byte boundary near a fragment start.
      const approx = total ? Math.floor(total * ratio) : 0;
      const aligned = Math.floor(approx / (64 * 1024)) * (64 * 1024);
      if (track === 'v') this.vOffset = aligned;
      else this.aOffset = aligned;
    }

    if (this._destroyed || gen !== this._gen) return;
    this._fetchLoop('v', gen);
    this._fetchLoop('a', gen);
  }

  destroy() {
    this._destroyed = true;
    this._gen++;
    this.el.removeEventListener('seeking', this._onSeek);
    try { if (this.ms.readyState === 'open') this.ms.endOfStream(); } catch { /* ok */ }
    if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
    this.el.src = '';
  }
}
