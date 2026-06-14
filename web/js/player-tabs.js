// player-tabs.js — the tabbed YouTube / Apple Music player, mounted directly
// into its container (the dashboard tile, or a standalone player.html).
//
// YouTube is mounted INLINE (not an iframe) via mountYoutube, because the
// Electron <webview> it uses for playback only initializes at the top level of
// a document — it stays inert inside an iframe. Apple Music has no webview, so
// it stays a lightweight iframe.
import { getConfig, setConfig } from './config.js';
import { mountYoutube } from './youtube-player.js';

export function mountPlayer(container, { apiParam = null, widgetBase = '' } = {}) {
  const suffix = apiParam ? `?api=${encodeURIComponent(apiParam)}` : '';
  container.classList.add('player-tabs');
  container.innerHTML = `
    <div class="player-tabbar" role="tablist">
      <button class="player-tab" data-tab="youtube" aria-pressed="true">&#9654; YouTube</button>
      <button class="player-tab" data-tab="media" aria-pressed="false">&#9835; Apple Music</button>
    </div>
    <div class="player-panes">
      <div class="player-pane" data-pane="youtube"></div>
      <iframe class="player-pane" data-pane="media" title="Apple Music"></iframe>
    </div>`;

  const panes = {
    youtube: container.querySelector('[data-pane="youtube"]'),
    media: container.querySelector('[data-pane="media"]'),
  };
  const ytApi = mountYoutube(panes.youtube);
  panes.media.src = `${widgetBase}media-player.html${suffix}`;
  const tabs = [...container.querySelectorAll('.player-tab')];

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
    tabs.forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.tab === tab)));
    active = tab;
    setConfig('playerTab', tab);
  }

  container.addEventListener('click', (e) => {
    const t = e.target.closest('.player-tab');
    if (t) show(t.dataset.tab);
  });

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
