// youtube-player.js — YouTube search + player. Playback uses a NATIVE <video>
// fed by a direct stream URL the host resolves with yt-dlp (/api/youtube/stream).
//
// We dropped the embedded IFrame player: YouTube now rejects embeds from a
// localhost origin with "Video unavailable / Error 152", and that can't be beaten
// with Referer/UA spoofing anymore. Streaming the file directly has no embed and
// no origin check. Anything yt-dlp can't resolve falls back to "Watch on YouTube".
import { fetchJson, apiUrl } from './host-bridge.js';
import { attachKeyboard } from './keyboard.js';
import { idleHide } from './idle-hide.js';

export function mountYoutube(container) {
  container.innerHTML = `
    <div class="yt" data-widget="youtube">
      <div class="yt-player">
        <video class="yt-video" data-field="video" playsinline controls></video>
        <div class="yt-loading hidden" data-field="loading"><div class="status-banner">Loading…</div></div>
      </div>
      <div class="yt-toolbar" data-field="toolbar">
        <button class="yt-btn" data-action="toggle-search">&#128269; Search</button>
      </div>
      <div class="yt-search" data-field="searchPanel">
        <div class="yt-search-bar">
          <input data-field="q" placeholder="Search music…" autocomplete="off" />
          <button class="yt-btn" data-action="close-search" aria-label="Close">&#10005;</button>
        </div>
        <div class="yt-results" data-field="results"></div>
        <div data-field="osk"></div>
      </div>
      <div class="yt-error hidden" data-field="error">
        <div class="status-banner">
          This video can&rsquo;t be played here.
          <a class="yt-watch" data-field="watch" target="_blank" rel="noopener">Watch on YouTube &#8599;</a>
        </div>
      </div>
    </div>`;

  const ytRoot = container.querySelector('.yt');
  const $ = (sel) => container.querySelector(sel);
  const panel = $('[data-field="searchPanel"]');
  const results = $('[data-field="results"]');
  const errorEl = $('[data-field="error"]');
  const loadingEl = $('[data-field="loading"]');
  const watchLink = $('[data-field="watch"]');
  const q = $('[data-field="q"]');
  const video = $('[data-field="video"]');
  const esc = (s) => {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  };

  const state = { results: [], lastLoaded: null, hls: null, mode: 'hls' };

  const showError = () => errorEl.classList.remove('hidden');
  const hideError = () => errorEl.classList.add('hidden');
  const setLoading = (on) => loadingEl.classList.toggle('hidden', !on);
  const toggleSearch = () => panel.classList.toggle('open');
  const closeSearch = () => panel.classList.remove('open');

  function teardownHls() {
    if (state.hls) {
      try {
        state.hls.destroy();
      } catch {
        /* ignore */
      }
      state.hls = null;
    }
  }

  // Try 720p HLS first (via the host's same-origin proxy); fall back to the
  // direct 360p progressive stream when HLS/MSE is unavailable or errors.
  function loadVideo(id) {
    hideError();
    state.lastLoaded = id; // set synchronously so callers/tests see the selection
    if (watchLink) watchLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    closeSearch();
    setLoading(true);
    teardownHls();
    const Hls = window.Hls;
    if (Hls && Hls.isSupported()) {
      state.mode = 'hls';
      const hls = new Hls({ maxBufferLength: 30 });
      state.hls = hls;
      hls.loadSource(apiUrl(`/api/youtube/hls?id=${encodeURIComponent(id)}`));
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (state.lastLoaded !== id) return;
        setLoading(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data && data.fatal) fallbackDirect(id); // 720p gone → 360p
      });
    } else {
      fallbackDirect(id);
    }
  }

  async function fallbackDirect(id) {
    if (state.lastLoaded !== id) return;
    state.mode = 'direct';
    teardownHls();
    try {
      const data = await fetchJson(`/api/youtube/stream?id=${encodeURIComponent(id)}`);
      if (state.lastLoaded !== id) return; // superseded by a newer selection
      if (!data || !data.url) throw new Error(data && data.error ? data.error : 'no stream');
      video.src = data.url;
      // Autoplay may be blocked without a gesture; controls remain either way.
      video.play().catch(() => {});
    } catch {
      if (state.lastLoaded === id) showError();
    } finally {
      if (state.lastLoaded === id) setLoading(false);
    }
  }

  function pause() {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
  }

  // A media error (e.g. an expired googlevideo URL) in DIRECT mode → offer the
  // YouTube link. In HLS mode, fatal errors are handled by Hls.Events.ERROR.
  video.addEventListener('error', () => {
    if (state.mode === 'direct' && video.currentSrc) showError();
  });

  async function search(query) {
    const term = (query || '').trim();
    if (!term) return;
    results.innerHTML = '<div class="status-banner">Searching…</div>';
    try {
      const data = await fetchJson(`/api/youtube/search?q=${encodeURIComponent(term)}`);
      state.results = data.items || [];
      if (!state.results.length) {
        results.innerHTML = '<div class="status-banner">No results — try another search.</div>';
        return;
      }
      renderResults();
    } catch {
      results.innerHTML = '<div class="status-banner">Search failed.</div>';
    }
  }

  function renderResults() {
    results.replaceChildren();
    for (const r of state.results) {
      if (!r.id) continue;
      const b = document.createElement('button');
      b.className = 'yt-result';
      b.dataset.videoId = r.id;
      b.innerHTML =
        `<img src="${esc(r.thumb)}" alt="" />` +
        `<span><span class="t">${esc(r.title)}</span><span class="c">${esc(r.channel)}</span></span>`;
      b.addEventListener('click', () => loadVideo(r.id));
      results.appendChild(b);
    }
  }

  // Drag-to-scroll the results list. The touch driver injects mouse (not touch)
  // events, so native finger-scroll doesn't happen — move scrollTop on drag, and
  // swallow the click that ends a real drag so it doesn't play a result.
  let dragStartY = null;
  let dragStartTop = 0;
  let dragMoved = false;
  results.addEventListener('pointerdown', (e) => {
    dragStartY = e.clientY;
    dragStartTop = results.scrollTop;
    dragMoved = false;
  });
  results.addEventListener('pointermove', (e) => {
    if (dragStartY === null) return;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dy) > 6) dragMoved = true;
    results.scrollTop = dragStartTop - dy;
  });
  const endDrag = () => {
    dragStartY = null;
  };
  results.addEventListener('pointerup', endDrag);
  results.addEventListener('pointercancel', endDrag);
  results.addEventListener(
    'click',
    (e) => {
      if (dragMoved) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true, // capture, so it pre-empts the result button's click
  );

  ytRoot.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'toggle-search') toggleSearch();
    else if (a.dataset.action === 'close-search') closeSearch();
  });

  idleHide($('[data-field="toolbar"]'), { timeoutMs: 30000 });
  attachKeyboard($('[data-field="osk"]'), q, { onEnter: search });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search(q.value);
  });

  ytRoot.dataset.ready = 'true';

  const api = {
    loadVideo,
    search,
    pause,
    simulateError: showError,
    get results() {
      return state.results;
    },
    get lastLoaded() {
      return state.lastLoaded;
    },
  };
  window.__yt = api; // test seam
  return api;
}
