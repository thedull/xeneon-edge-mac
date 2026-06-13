// grid.js — dashboard tile layout engine + swipe pagination.
// Widgets render in iframes (host-agnostic pages); the dashboard forwards its
// own ?api= origin so child widgets resolve the same API.
import { getConfig, setConfig } from './config.js';

// Each tile positions a widget in the 2x2 (1280x360) grid via CSS grid lines.
export const LAYOUTS = {
  default: {
    label: 'Default',
    pages: [
      [
        { widget: 'youtube', col: '1', row: '1 / span 2' },
        { widget: 'system-monitor', col: '2', row: '1' },
        { widget: 'media-player', col: '2', row: '2' },
      ],
      [
        { widget: 'processes', col: '1', row: '1 / span 2' },
        { widget: 'ai-usage', col: '2', row: '1 / span 2' },
      ],
    ],
  },
  focus: {
    label: 'Focus',
    pages: [
      [
        { widget: 'youtube', col: '1', row: '1 / span 2' },
        { widget: 'system-monitor', col: '2', row: '1 / span 2' },
      ],
    ],
  },
};

export function initGrid(root) {
  const apiParam = new URLSearchParams(location.search).get('api');
  let presetName = getConfig('preset', 'default');
  if (!LAYOUTS[presetName]) presetName = 'default';
  let index = clampIndex(Number.parseInt(getConfig('page', '0'), 10), presetName);

  const stage = el('div', 'stage');
  const pager = el('div', 'pager');
  const dots = el('nav', 'dots');
  const prevBtn = navBtn('prev', '‹');
  const nextBtn = navBtn('next', '›');
  stage.append(pager, prevBtn, nextBtn, dots);
  root.replaceChildren(stage);

  function render() {
    const preset = LAYOUTS[presetName];
    pager.replaceChildren();
    pager.style.width = `${preset.pages.length * 2560}px`;
    preset.pages.forEach((page) => {
      const pageEl = el('section', 'page');
      for (const tile of page) {
        const t = el('div', 'tile');
        t.style.gridColumn = tile.col;
        t.style.gridRow = tile.row;
        t.dataset.widget = tile.widget;
        const frame = document.createElement('iframe');
        frame.className = 'tile-frame';
        frame.setAttribute('title', tile.widget);
        let src = `widgets/${tile.widget}.html`;
        if (apiParam) src += `?api=${encodeURIComponent(apiParam)}`;
        frame.src = src;
        t.appendChild(frame);
        pageEl.appendChild(t);
      }
      pager.appendChild(pageEl);
    });
    renderDots();
    update();
  }

  function renderDots() {
    const preset = LAYOUTS[presetName];
    dots.replaceChildren();
    preset.pages.forEach((_, i) => {
      const d = document.createElement('button');
      d.className = 'dot';
      d.type = 'button';
      d.setAttribute('data-dot', String(i));
      d.addEventListener('click', () => goTo(i));
      dots.appendChild(d);
    });
  }

  function update() {
    pager.style.transform = `translateX(${-index * 2560}px)`;
    [...dots.children].forEach((d, i) => d.classList.toggle('active', i === index));
    const count = LAYOUTS[presetName].pages.length;
    prevBtn.style.visibility = count > 1 ? 'visible' : 'hidden';
    nextBtn.style.visibility = count > 1 ? 'visible' : 'hidden';
    setConfig('page', index);
  }

  function clampIndex(i, name) {
    const count = LAYOUTS[name].pages.length;
    if (Number.isNaN(i)) return 0;
    return Math.max(0, Math.min(count - 1, i));
  }

  function goTo(i) {
    index = clampIndex(i, presetName);
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

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);

  // Touch / pointer swipe on the stage (ignore drags that start inside an iframe
  // tile so widget interactions aren't hijacked — only the gutters swipe).
  let startX = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tile-frame')) return;
    startX = e.clientX;
  });
  stage.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 80) (dx < 0 ? next : prev)();
    startX = null;
  });

  render();

  const api = {
    goTo,
    next,
    prev,
    setPreset,
    get index() {
      return index;
    },
    get preset() {
      return presetName;
    },
    get pageCount() {
      return LAYOUTS[presetName].pages.length;
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

function navBtn(name, label) {
  const b = el('button', `nav ${name}`);
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('data-nav', name);
  return b;
}
