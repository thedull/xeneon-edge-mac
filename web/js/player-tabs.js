// player-tabs.js — the YouTube / Apple Music player. Source switching is via a
// small floating pill that idle-hides. Horizontal swipe is reserved for page
// navigation (handled by grid.js), so the player tile opts out of the stage
// pager (see grid.js).
//
// YouTube is mounted INLINE (not an iframe) via mountYoutube — its native <video>
// is a direct child of this document. Apple Music stays a lightweight iframe.
import { getConfig, setConfig } from './config.js';
import { idleHide } from './idle-hide.js';
import { mountYoutube } from './youtube-player.js';

export function mountPlayer(container, { apiParam = null, widgetBase = '' } = {}) {
  const suffix = apiParam ? `?api=${encodeURIComponent(apiParam)}` : '';
  container.classList.add('player-tabs');
  container.innerHTML = `
    <div class="player-panes">
      <div class="player-pane" data-pane="youtube"></div>
      <iframe class="player-pane" data-pane="media" title="Apple Music"></iframe>
    </div>
    <div class="player-pill" data-field="pill" role="tablist">
      <button class="player-seg" data-tab="youtube" aria-pressed="true">&#9654; YouTube</button>
      <button class="player-seg" data-tab="media" aria-pressed="false">&#9835; Music</button>
    </div>`;

  const panes = {
    youtube: container.querySelector('[data-pane="youtube"]'),
    media: container.querySelector('[data-pane="media"]'),
  };
  const pill = container.querySelector('[data-field="pill"]');
  const segs = [...container.querySelectorAll('.player-seg')];
  const ytApi = mountYoutube(panes.youtube);
  panes.media.src = `${widgetBase}media-player.html${suffix}`;

  let active = getConfig('playerTab', 'youtube');
  if (!panes[active]) active = 'youtube';

  function pauseOther(tab) {
    // Pause the source we're leaving so the two never play at once.
    if (tab !== 'youtube') ytApi.pause();
    if (tab !== 'media') {
      try {
        panes.media.contentWindow.postMessage({ type: 'player:pause' }, '*');
      } catch {
        /* not ready — ignore */
      }
    }
  }

  function show(tab) {
    if (!panes[tab]) return;
    for (const [name, el] of Object.entries(panes)) {
      el.classList.toggle('active', name === tab);
    }
    pauseOther(tab);
    segs.forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.tab === tab)));
    active = tab;
    setConfig('playerTab', tab);
  }
  // Tap a pill segment to switch source. (Swipe-to-switch was removed — a
  // vertical swipe fought scrolling the search results; the pill is now the only
  // switch affordance.)
  pill.addEventListener('click', (e) => {
    const s = e.target.closest('.player-seg');
    if (s) show(s.dataset.tab);
  });

  // Fade the pill after 30s idle → clean full-bleed player when unattended.
  idleHide(pill, { timeoutMs: 30000, root: container });

  show(active);

  const api = {
    show,
    get active() {
      return active;
    },
  };
  if (container === document.body || container.dataset.widget === 'player') {
    window.__player = api;
  }
  return api;
}
