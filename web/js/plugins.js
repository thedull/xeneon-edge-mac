// plugins.js — installed iCUE-widget management for the dashboard: the Library
// (import / add / remove / reorder) and per-widget Settings. Added widgets are
// rendered as their own dashboard pages by grid.js. State lives in config.js
// (localStorage): the ordered list of added ids, plus per-widget settings.
import { getConfig, setConfig } from './config.js';
import { fetchJson, apiUrl } from './host-bridge.js';

const ADDED_KEY = 'plugins';
const CFG_PREFIX = 'pluginCfg.';

// ---- state (config-backed) -------------------------------------------------
export function getAdded() {
  try {
    const a = JSON.parse(getConfig(ADDED_KEY, '[]'));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function setAdded(ids) {
  setConfig(ADDED_KEY, JSON.stringify(ids));
}
export function isAdded(id) {
  return getAdded().includes(id);
}
export function addWidget(id) {
  const a = getAdded();
  if (!a.includes(id)) {
    a.push(id);
    setAdded(a);
  }
}
export function removeWidget(id) {
  setAdded(getAdded().filter((x) => x !== id));
}
export function moveWidget(id, dir) {
  const a = getAdded();
  const i = a.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  setAdded(a);
}
export function getCfg(id) {
  try {
    return JSON.parse(getConfig(CFG_PREFIX + id, '{}')) || {};
  } catch {
    return {};
  }
}
export function setCfg(id, obj) {
  setConfig(CFG_PREFIX + id, JSON.stringify(obj || {}));
}

// ---- server API ------------------------------------------------------------
export async function fetchInstalled() {
  try {
    return (await fetchJson('/api/plugins')).plugins || [];
  } catch {
    return [];
  }
}
async function importPackage(file) {
  const buf = await file.arrayBuffer();
  const res = await fetch(apiUrl('/api/plugins/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
  return d.plugin;
}
async function uninstallPackage(id) {
  await fetch(apiUrl(`/api/plugins/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

// The added widgets that are actually installed, in user order, for grid.js.
export async function loadAddedPages() {
  const installed = await fetchInstalled();
  const byId = new Map(installed.map((m) => [m.id, m]));
  return getAdded()
    .map((id) => byId.get(id))
    .filter(Boolean);
}

export function pluginIframeSrc(meta, apiParam) {
  let src = `plugins/installed/${meta.id}/index.html?api=${encodeURIComponent(apiParam || location.origin)}`;
  const cfg = getCfg(meta.id);
  if (Object.keys(cfg).length) src += `&cfg=${encodeURIComponent(JSON.stringify(cfg))}`;
  return src;
}

// iCUE labels are often tr('Something'); show the inner text.
export function trText(s) {
  if (typeof s !== 'string') return s;
  const m = s.match(/^tr\(\s*['"]([\s\S]*?)['"]\s*\)$/);
  return m ? m[1] : s;
}

// ---- UI: Library + Settings ------------------------------------------------
const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
};

function modal(title) {
  const overlay = document.createElement('div');
  overlay.className = 'plib-overlay';
  overlay.innerHTML = `
    <div class="plib" role="dialog" aria-modal="true">
      <div class="plib-head">
        <span class="plib-title">${esc(title)}</span>
        <button class="plib-x" data-act="close" aria-label="Close">&#10005;</button>
      </div>
      <div class="plib-body"></div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-act="close"]')) close();
  });
  document.body.appendChild(overlay);
  return { overlay, body: overlay.querySelector('.plib-body'), close };
}

export async function openLibrary({ apiParam, onChange } = {}) {
  const { body } = modal('Widgets');
  const refresh = async () => {
    const installed = await fetchInstalled();
    renderList(installed);
  };
  const notify = () => onChange && onChange();

  body.innerHTML = `
    <label class="plib-import">
      <input type="file" accept=".icuewidget,application/zip" hidden data-field="file" />
      <span>Import a <code>.icuewidget</code> — drop here or click</span>
    </label>
    <div class="plib-list" data-field="list"><div class="plib-empty">Loading…</div></div>`;

  const fileInput = body.querySelector('[data-field="file"]');
  const dropZone = body.querySelector('.plib-import');
  const list = body.querySelector('[data-field="list"]');

  async function doImport(file) {
    if (!file) return;
    dropZone.classList.add('busy');
    try {
      const m = await importPackage(file);
      addWidget(m.id); // auto-add freshly imported widgets to the dashboard
      notify();
      await refresh();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      dropZone.classList.remove('busy');
    }
  }
  fileInput.addEventListener('change', () => doImport(fileInput.files[0]));
  ['dragover', 'dragenter'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove('over');
    }),
  );
  dropZone.addEventListener('drop', (e) => doImport(e.dataTransfer.files[0]));

  function renderList(installed) {
    if (!installed.length) {
      list.innerHTML = `<div class="plib-empty">No widgets installed yet. Import a <code>.icuewidget</code> above.</div>`;
      return;
    }
    const order = getAdded();
    installed.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi);
    });
    list.innerHTML = installed
      .map((m) => {
        const added = order.includes(m.id);
        return `<div class="plib-item" data-id="${esc(m.id)}">
          <div class="plib-meta">
            <span class="plib-name">${esc(m.name)}</span>
            <span class="plib-sub">${esc(m.devices.join(', '))}${m.version ? ' · v' + esc(m.version) : ''}</span>
          </div>
          <div class="plib-actions">
            ${added ? `<button class="plib-btn" data-act="up" title="Move up">&#8593;</button>
                       <button class="plib-btn" data-act="down" title="Move down">&#8595;</button>` : ''}
            ${m.settings && m.settings.length ? `<button class="plib-btn" data-act="settings">Settings</button>` : ''}
            <button class="plib-btn ${added ? 'on' : ''}" data-act="toggle">${added ? 'Remove' : 'Add'}</button>
            <button class="plib-btn danger" data-act="uninstall" title="Uninstall">&#128465;</button>
          </div>
        </div>`;
      })
      .join('');
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.plib-item').dataset.id;
    const act = btn.dataset.act;
    if (act === 'toggle') {
      isAdded(id) ? removeWidget(id) : addWidget(id);
      notify();
      await refresh();
    } else if (act === 'up' || act === 'down') {
      moveWidget(id, act === 'up' ? -1 : 1);
      notify();
      await refresh();
    } else if (act === 'uninstall') {
      if (!confirm('Uninstall this widget and remove its files?')) return;
      removeWidget(id);
      await uninstallPackage(id);
      notify();
      await refresh();
    } else if (act === 'settings') {
      const installed = await fetchInstalled();
      const meta = installed.find((m) => m.id === id);
      if (meta) openSettings(meta, { onChange: notify });
    }
  });

  await refresh();
}

export function openSettings(meta, { onChange } = {}) {
  const { body } = modal(`${meta.name} — Settings`);
  const cfg = getCfg(meta.id);
  const fields = (meta.settings || [])
    .map((p) => {
      const val = p.name in cfg ? cfg[p.name] : p.default;
      return `<label class="pset-row">
        <span class="pset-label">${esc(trText(p.label))}</span>
        ${control(p, val)}
      </label>`;
    })
    .join('');
  body.innerHTML = `
    <form class="pset" data-field="form">
      ${fields || '<div class="plib-empty">This widget has no settings.</div>'}
      <div class="pset-actions">
        <button type="button" class="plib-btn" data-act="reset">Reset</button>
        <button type="submit" class="plib-btn on">Apply</button>
      </div>
    </form>`;
  const form = body.querySelector('[data-field="form"]');

  function readForm() {
    const next = {};
    (meta.settings || []).forEach((p) => {
      const node = form.elements[p.name];
      if (!node) return;
      if (p.type === 'switch') next[p.name] = node.checked;
      else if (p.type === 'slider') next[p.name] = Number(node.value);
      else next[p.name] = node.value;
    });
    return next;
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setCfg(meta.id, readForm());
    onChange && onChange();
    body.closest('.plib-overlay').remove();
  });
  form.querySelector('[data-act="reset"]').addEventListener('click', () => {
    setCfg(meta.id, {});
    onChange && onChange();
    body.closest('.plib-overlay').remove();
  });
}

function control(p, val) {
  const name = esc(p.name);
  if (p.type === 'color') {
    return `<input type="color" name="${name}" value="${esc(val || '#5bc8ff')}" />`;
  }
  if (p.type === 'switch') {
    return `<input type="checkbox" name="${name}" ${val ? 'checked' : ''} />`;
  }
  if (p.type === 'slider') {
    const min = p.min ?? 0;
    const max = p.max ?? 100;
    const step = p.step ?? 1;
    return `<input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${esc(val ?? min)}" />`;
  }
  if ((p.type === 'combobox' || p.type === 'tab-buttons') && Array.isArray(p.options)) {
    const opts = p.options
      .map((o) => {
        const v = typeof o === 'object' ? o.value ?? o.id : o;
        const lbl = typeof o === 'object' ? o.label ?? o.name ?? v : o;
        return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(trText(lbl))}</option>`;
      })
      .join('');
    return `<select name="${name}">${opts}</select>`;
  }
  return `<input type="text" name="${name}" value="${esc(val ?? '')}" />`;
}
