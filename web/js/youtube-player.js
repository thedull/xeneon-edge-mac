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

const PLAYLIST_RE = /[?&]list=([A-Za-z0-9_-]+)/;

export function mountYoutube(container) {
  container.innerHTML = `
    <div class="yt" data-widget="youtube">
      <div class="yt-player">
        <video class="yt-video" data-field="video" playsinline controls></video>
        <div class="yt-loading hidden" data-field="loading"><div class="status-banner">Loading…</div></div>
        <div class="yt-next-up hidden" data-field="nextUp">
          <span class="yt-next-up-label">Next up</span>
          <span class="yt-next-up-title" data-field="nextUpTitle"></span>
          <button class="yt-btn yt-next-up-cancel" data-action="cancel-next" aria-label="Cancel">&#10005;</button>
        </div>
      </div>
      <div class="yt-toolbar" data-field="toolbar">
        <button class="yt-btn" data-action="toggle-search">&#128269; Search</button>
      </div>
      <div class="yt-search" data-field="searchPanel">
        <div class="yt-search-bar">
          <input data-field="q" placeholder="Search or paste playlist URL…" autocomplete="off" />
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
  const nextUpEl = $('[data-field="nextUp"]');
  const nextUpTitleEl = $('[data-field="nextUpTitle"]');
  const watchLink = $('[data-field="watch"]');
  const q = $('[data-field="q"]');
  const video = $('[data-field="video"]');
  const esc = (s) => {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  };

  const state = {
    results: [],      // items shown in the search panel
    queue: [],        // current play queue
    queueIndex: -1,   // index of currently playing item in queue
    lastLoaded: null,
    hls: null,
    mode: 'hls',
    autoAdvanceTimer: null,
    relatedFetched: new Set(), // video IDs we've already fetched related for
  };

  const showError = () => errorEl.classList.remove('hidden');
  const hideError = () => errorEl.classList.add('hidden');
  const setLoading = (on) => loadingEl.classList.toggle('hidden', !on);
  const toggleSearch = () => panel.classList.toggle('open');
  const closeSearch = () => panel.classList.remove('open');

  function cancelAutoAdvance() {
    if (state.autoAdvanceTimer) {
      clearTimeout(state.autoAdvanceTimer);
      state.autoAdvanceTimer = null;
    }
    nextUpEl.classList.add('hidden');
  }

  function teardownHls() {
    if (state.hls) {
      try { state.hls.destroy(); } catch { /* ignore */ }
      state.hls = null;
    }
  }

  // Highlight the currently playing result in the list.
  function updateNowPlaying() {
    for (const btn of results.querySelectorAll('.yt-result')) {
      btn.classList.toggle('yt-result--playing', btn.dataset.videoId === state.lastLoaded);
    }
  }

  // Fetch related videos for `id` in the background and append novel ones to queue.
  async function fetchRelated(id) {
    if (state.relatedFetched.has(id)) return;
    state.relatedFetched.add(id);
    try {
      const data = await fetchJson(`/api/youtube/related?id=${encodeURIComponent(id)}`);
      const items = data?.items || [];
      if (!items.length) return;
      const existing = new Set(state.queue.map((v) => v.id));
      const fresh = items.filter((v) => v.id && !existing.has(v.id));
      if (fresh.length) state.queue.push(...fresh);
    } catch { /* non-critical */ }
  }

  function scheduleNext() {
    const nextIndex = state.queueIndex + 1;
    if (nextIndex >= state.queue.length) {
      // Queue exhausted — nothing to auto-advance to.
      return;
    }
    const next = state.queue[nextIndex];
    nextUpTitleEl.textContent = next.title || '';
    nextUpEl.classList.remove('hidden');
    state.autoAdvanceTimer = setTimeout(() => {
      nextUpEl.classList.add('hidden');
      state.autoAdvanceTimer = null;
      state.queueIndex = nextIndex;
      loadVideo(next.id);
    }, 3000);
  }

  // Try 1080p HLS first (via the host's same-origin proxy); fall back to the
  // direct 360p progressive stream when HLS/MSE is unavailable or errors.
  function loadVideo(id) {
    cancelAutoAdvance();
    hideError();
    state.lastLoaded = id;
    if (watchLink) watchLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    closeSearch();
    setLoading(true);
    teardownHls();
    updateNowPlaying();
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
        fetchRelated(id);
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data && data.fatal) fallbackDirect(id);
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
      if (state.lastLoaded !== id) return;
      if (!data || !data.url) throw new Error(data && data.error ? data.error : 'no stream');
      video.src = data.url;
      video.play().catch(() => {});
      fetchRelated(id);
    } catch {
      if (state.lastLoaded === id) showError();
    } finally {
      if (state.lastLoaded === id) setLoading(false);
    }
  }

  function pause() {
    try { video.pause(); } catch { /* ignore */ }
  }

  video.addEventListener('error', () => {
    if (state.mode === 'direct' && video.currentSrc) showError();
  });

  video.addEventListener('ended', () => {
    scheduleNext();
  });

  // ── Search & playlist loading ────────────────────────────────────────────────

  async function loadPlaylist(url) {
    results.innerHTML = '<div class="status-banner">Loading playlist…</div>';
    try {
      const data = await fetchJson(`/api/youtube/playlist?url=${encodeURIComponent(url)}`);
      const items = data?.items || [];
      if (!items.length) {
        results.innerHTML = '<div class="status-banner">Playlist is empty or unavailable.</div>';
        return;
      }
      state.results = items;
      state.queue = items.slice();
      state.queueIndex = 0;
      renderResults();
      loadVideo(items[0].id);
    } catch {
      results.innerHTML = '<div class="status-banner">Could not load playlist.</div>';
    }
  }

  async function search(query) {
    const term = (query || '').trim();
    if (!term) return;

    // Detect a YouTube playlist URL pasted into the search box.
    if (PLAYLIST_RE.test(term) && term.includes('youtube.com')) {
      loadPlaylist(term);
      return;
    }

    results.innerHTML = '<div class="status-banner">Searching…</div>';
    try {
      const data = await fetchJson(`/api/youtube/search?q=${encodeURIComponent(term)}`);
      state.results = data.items || [];
      if (!state.results.length) {
        results.innerHTML = '<div class="status-banner">No results — try another search.</div>';
        return;
      }
      state.queue = state.results.slice();
      state.queueIndex = -1;
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
      b.addEventListener('click', () => {
        const idx = state.queue.findIndex((v) => v.id === r.id);
        state.queueIndex = idx >= 0 ? idx : 0;
        loadVideo(r.id);
      });
      results.appendChild(b);
    }
    updateNowPlaying();
  }

  // ── Drag-to-scroll results ───────────────────────────────────────────────────
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
  const endDrag = () => { dragStartY = null; };
  results.addEventListener('pointerup', endDrag);
  results.addEventListener('pointercancel', endDrag);
  results.addEventListener('click', (e) => {
    if (dragMoved) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  // ── Event delegation ─────────────────────────────────────────────────────────
  ytRoot.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    switch (a.dataset.action) {
      case 'toggle-search': toggleSearch(); break;
      case 'close-search': closeSearch(); break;
      case 'cancel-next': cancelAutoAdvance(); break;
    }
  });

  // Tapping the "next up" banner body (not ✕) advances immediately.
  nextUpEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel-next"]')) return;
    cancelAutoAdvance();
    const nextIndex = state.queueIndex + 1;
    if (nextIndex < state.queue.length) {
      state.queueIndex = nextIndex;
      loadVideo(state.queue[nextIndex].id);
    }
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
    get results() { return state.results; },
    get queue() { return state.queue; },
    get queueIndex() { return state.queueIndex; },
    get lastLoaded() { return state.lastLoaded; },
  };
  window.__yt = api;
  return api;
}
