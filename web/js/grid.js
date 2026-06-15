// grid.js — dashboard tile layout engine + swipe pagination.
// Widgets render in iframes (host-agnostic pages); the dashboard forwards its
// own ?api= origin so child widgets resolve the same API. Imported iCUE widgets
// (see plugins.js) are appended as their own pages after the preset pages.
import { getConfig, setConfig } from './config.js';
import { idleHide } from './idle-hide.js';
import { mountPlayer } from './player-tabs.js';
import {
  loadAddedPages,
  pluginIframeSrc,
  openLibrary,
  openSettings,
  removeWidget,
  trText,
} from './plugins.js';

// The page is a 4-column grid: a 1280px player column on the left, then three
// equal columns on the right. Tiles position via CSS grid lines.
//   Page 1:  [ player ][ system-monitor: CPU · Mem · Disk          ]
//            [ player ][ processes (66%)        ][ network (33%)   ]
//   Page 2:  [ ai-usage (full) ]
//   Page 3+: one per imported iCUE widget
export const LAYOUTS = {
  default: {
    label: 'Default',
    pages: [
      [
        { widget: 'player', col: '1', row: '1 / span 2' },
        { widget: 'system-monitor', col: '2 / span 3', row: '1' },
        { widget: 'processes', col: '2 / span 2', row: '2' },
        { widget: 'network', col: '4', row: '2' },
      ],
      [{ widget: 'ai-usage', col: '1 / -1', row: '1 / span 2' }],
    ],
  },
};

export function initGrid(root) {
  const apiParam = new URLSearchParams(location.search).get('api');
  let presetName = getConfig('preset', 'default');
  if (!LAYOUTS[presetName]) presetName = 'default';
  let pluginMetas = []; // added + installed iCUE widgets, in user order
  const totalPages = () => LAYOUTS[presetName].pages.length + pluginMetas.length;
  let index = clampIndex(Number.parseInt(getConfig('page', '0'), 10));

  const stage = el('div', 'stage');
  const pager = el('div', 'pager');
  const prevBtn = navBtn('prev', '‹');
  const nextBtn = navBtn('next', '›');
  const libBtn = el('button', 'nav lib');
  libBtn.type = 'button';
  libBtn.textContent = '⊞'; // ⊞
  libBtn.title = 'Widgets';
  stage.append(pager, prevBtn, nextBtn, libBtn);
  root.replaceChildren(stage);

  function render() {
    pager.replaceChildren();
    pager.style.width = `${totalPages() * 2560}px`;
    for (const page of LAYOUTS[presetName].pages) pager.appendChild(presetPage(page));
    for (const meta of pluginMetas) pager.appendChild(pluginPage(meta));
    update();
  }

  function presetPage(page) {
    const pageEl = el('section', 'page');
    for (const tile of page) {
      const t = el('div', 'tile');
      t.style.gridColumn = tile.col;
      t.style.gridRow = tile.row;
      t.dataset.widget = tile.widget;
      if (tile.widget === 'player') {
        mountPlayer(t, { apiParam, widgetBase: 'widgets/' });
      } else {
        t.appendChild(tileFrame(`widgets/${tile.widget}.html`, tile.widget));
      }
      pageEl.appendChild(t);
    }
    return pageEl;
  }

  function pluginPage(meta) {
    const pageEl = el('section', 'page plugin-page');
    const wrap = el('div', 'plugin-stage');
    const frame = tileFrame(pluginIframeSrc(meta, apiParam), meta.name, false);
    frame.classList.add('plugin-frame');
    frame.style.width = `${meta.slot.w}px`;
    frame.style.height = `${meta.slot.h}px`;
    wrap.appendChild(frame);
    // Per-widget toolbar (settings + remove), idle-hidden like the nav arrows.
    const bar = el('div', 'plugin-toolbar');
    bar.innerHTML = `<span class="plugin-name">${esc(trText(meta.name))}</span>
      ${meta.settings && meta.settings.length ? '<button class="nav small" data-act="settings" title="Settings">⚙</button>' : ''}
      <button class="nav small" data-act="remove" title="Remove from dashboard">✕</button>`;
    bar.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'settings') openSettings(meta, { onChange: refreshPlugins });
      else if (b.dataset.act === 'remove') {
        removeWidget(meta.id);
        await refreshPlugins();
      }
    });
    idleHide(bar, { timeoutMs: 30000, root: pageEl });
    pageEl.append(wrap, bar);
    return pageEl;
  }

  function tileFrame(src, title, withApi = true) {
    const frame = document.createElement('iframe');
    frame.className = 'tile-frame';
    frame.setAttribute('title', title);
    frame.allow = 'autoplay; fullscreen; encrypted-media';
    frame.setAttribute('allowfullscreen', '');
    if (withApi && apiParam) src += `${src.includes('?') ? '&' : '?'}api=${encodeURIComponent(apiParam)}`;
    frame.src = src;
    return frame;
  }

  function update() {
    pager.style.transform = `translateX(${-index * 2560}px)`;
    const many = totalPages() > 1;
    prevBtn.style.visibility = many ? 'visible' : 'hidden';
    nextBtn.style.visibility = many ? 'visible' : 'hidden';
    setConfig('page', index);
  }

  function clampIndex(i) {
    if (Number.isNaN(i)) return 0;
    return Math.max(0, Math.min(totalPages() - 1, i));
  }

  function goTo(i) {
    index = clampIndex(i);
    update();
  }
  const next = () => goTo(index + 1);
  const prev = () => goTo(index - 1);

  function setPreset(name) {
    if (!LAYOUTS[name]) return;
    presetName = name;
    setConfig('preset', name);
    index = 0;
    render();
  }

  // Re-fetch the added widgets and re-render, keeping the current page in range.
  async function refreshPlugins() {
    pluginMetas = await loadAddedPages();
    index = clampIndex(index);
    render();
  }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  libBtn.addEventListener('click', () => openLibrary({ apiParam, onChange: refreshPlugins }));

  // Touch / pointer swipe on the stage (ignore drags that start inside an iframe
  // tile so widget interactions aren't hijacked — only the gutters swipe).
  let startX = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tile-frame, .player-tabs')) return;
    startX = e.clientX;
  });
  stage.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 80) (dx < 0 ? next : prev)();
    startX = null;
  });

  // Widget iframes can't bubble pointer events to the stage, so they postMessage
  // their swipe intent here (see web/js/swipe-nav.js). Validate origin + source.
  const apiOrigin = (() => {
    try {
      return apiParam ? new URL(apiParam).origin : null;
    } catch {
      return null;
    }
  })();
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin && e.origin !== apiOrigin) return;
    if (!e.data || e.data.type !== 'nav:swipe') return;
    const fromTile = [...pager.querySelectorAll('iframe')].some((f) => f.contentWindow === e.source);
    if (!fromTile) return;
    if (e.data.dir === 'next') next();
    else prev();
  });

  render();
  refreshPlugins(); // load imported widgets (async) and re-render

  // Fade the nav affordances out after 30s idle; any interaction brings them back.
  idleHide([prevBtn, nextBtn, libBtn], { timeoutMs: 30000, root: stage });

  const api = {
    goTo,
    next,
    prev,
    setPreset,
    refreshPlugins,
    get index() {
      return index;
    },
    get preset() {
      return presetName;
    },
    get pageCount() {
      return totalPages();
    },
  };
  window.__grid = api;
  return api;
}

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function navBtn(name, label) {
  const b = el('button', `nav ${name}`);
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('data-nav', name);
  return b;
}
