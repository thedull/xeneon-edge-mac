// youtube-player.js — the YouTube search + player, mounted directly into a
// container (the dashboard player tile, or a standalone youtube.html). Mounting
// inline (NOT inside an iframe) keeps the IFrame player a direct child of the
// host document — the clean, original embedded player. Videos whose owners
// disabled web embedding fall back to the "Watch on YouTube" link.
import { fetchJson } from './host-bridge.js';
import { attachKeyboard } from './keyboard.js';
import { idleHide } from './idle-hide.js';

export function mountYoutube(container) {
  // Inner .yt wrapper (the container itself may be a positioned tile pane).
  container.innerHTML = `
    <div class="yt" data-widget="youtube">
      <div class="yt-player"><div class="yt-iframe-host"></div></div>
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
          This video can&rsquo;t be embedded.
          <a class="yt-watch" data-field="watch" target="_blank" rel="noopener">Watch on YouTube &#8599;</a>
        </div>
      </div>
    </div>`;

  const ytRoot = container.querySelector('.yt');
  const $ = (sel) => container.querySelector(sel);
  const panel = $('[data-field="searchPanel"]');
  const results = $('[data-field="results"]');
  const errorEl = $('[data-field="error"]');
  const watchLink = $('[data-field="watch"]');
  const q = $('[data-field="q"]');
  const playerHost = $('.yt-iframe-host');
  const esc = (s) => {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  };

  const state = { results: [], lastLoaded: null };
  let player = null;
  let pendingId = null;

  // --- YouTube IFrame Player API (the clean embedded player) ---
  function initPlayer() {
    try {
      player = new window.YT.Player(playerHost, {
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, modestbranding: 1, rel: 0, autoplay: 1 },
        events: {
          onReady: () => {
            if (pendingId) loadVideo(pendingId);
          },
          onError: () => showError(),
        },
      });
    } catch {
      /* player stays null; search still works */
    }
  }

  function ensureApi() {
    if (window.YT && window.YT.Player) return initPlayer();
    // The API calls a single global callback when ready.
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      initPlayer();
    };
    if (document.querySelector('script[data-yt-api]')) return;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.setAttribute('data-yt-api', '');
    s.onerror = () => {};
    document.head.appendChild(s);
  }

  function loadVideo(id) {
    hideError();
    state.lastLoaded = id;
    if (watchLink) watchLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    pendingId = id;
    if (player && typeof player.loadVideoById === 'function') {
      player.loadVideoById(id);
      pendingId = null;
    }
    closeSearch();
  }

  function pause() {
    try {
      if (player && player.pauseVideo) player.pauseVideo();
    } catch {
      /* ignore */
    }
  }

  const showError = () => errorEl.classList.remove('hidden');
  const hideError = () => errorEl.classList.add('hidden');
  const toggleSearch = () => panel.classList.toggle('open');
  const closeSearch = () => panel.classList.remove('open');

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

  ensureApi();
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
