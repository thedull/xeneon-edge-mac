// plugins.mjs — installed iCUE-widget registry + importer. Widgets live under
// web/plugins/installed/<id>/ (git-ignored); each is a .icuewidget package
// (index.html + manifest.json + assets). The runtime shim is injected when they
// are served (see server.mjs / icue-shim.js).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const INSTALLED = path.resolve(here, '../../../web/plugins/installed');
const ID_RE = /^[A-Za-z0-9._-]+$/;

function sanitizeId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return ID_RE.test(id) ? id : '';
}

// Default tile slot per device class (the widget is responsive within it).
function slotFor(devices = []) {
  const types = devices.map((d) => d.type);
  if (types.includes('dashboard_lcd')) return { w: 1268, h: 696 };
  return { w: 560, h: 560 }; // pump_lcd / keyboard_lcd are square-ish
}

// Parse the widget's settings schema from its index.html <meta x-icue-property>.
async function readSchema(dir) {
  let html = '';
  try {
    html = await readFile(path.join(dir, 'index.html'), 'utf8');
  } catch {
    return [];
  }
  const props = [];
  const re = /<meta\s+name=["']x-icue-property["'][^>]*>/gi;
  // Delimiter-aware: the value may itself contain the other quote, e.g.
  // data-label="tr('City')" or data-default="'#FFFFFF'".
  const pick = (tag, name) => {
    const m = tag.match(new RegExp(`${name}=("([^"]*)"|'([^']*)')`, 'i'));
    return m ? (m[2] != null ? m[2] : m[3]) : null;
  };
  const attr = (tag, name) => pick(tag, `data-${name}`);
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const name = pick(tag, 'content');
    if (!name) continue;
    let dflt = attr(tag, 'default');
    try {
      if (dflt != null) dflt = Function(`return (${dflt})`)();
    } catch {
      /* keep raw */
    }
    const num = (n) => {
      const v = attr(tag, n);
      return v == null || v === '' ? undefined : Number(v);
    };
    let options;
    const rawOpts = attr(tag, 'options');
    if (rawOpts) {
      try {
        options = JSON.parse(rawOpts);
      } catch {
        options = rawOpts.split(',').map((s) => s.trim());
      }
    }
    props.push({
      name,
      label: attr(tag, 'label') || name,
      type: attr(tag, 'type') || 'textfield',
      default: dflt,
      min: num('min'),
      max: num('max'),
      step: num('step'),
      options,
    });
  }
  return props;
}

async function meta(id) {
  const dir = path.join(INSTALLED, id);
  let m;
  try {
    m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
  return {
    id,
    name: m.name || id,
    description: m.description || '',
    author: m.author || '',
    version: m.version || '',
    devices: (m.supported_devices || []).map((d) => d.type),
    interactive: !!m.interactive,
    icon: m.preview_icon ? `/plugins/installed/${id}/${m.preview_icon}` : null,
    slot: slotFor(m.supported_devices || []),
    settings: await readSchema(dir),
  };
}

export async function listPlugins() {
  let entries = [];
  try {
    entries = await readdir(INSTALLED, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = await meta(e.name);
    if (m) out.push(m);
  }
  return out;
}

// Unzip a .icuewidget package (raw bytes) into web/plugins/installed/<id>/.
export async function importPlugin(buffer) {
  if (!buffer || !buffer.length) throw new Error('empty package');
  await mkdir(INSTALLED, { recursive: true });
  const stamp = `${Date.now()}-${buffer.length}`;
  const tmpZip = path.join(os.tmpdir(), `xem-widget-${stamp}.zip`);
  const tmpDir = path.join(os.tmpdir(), `xem-widget-${stamp}`);
  try {
    await writeFile(tmpZip, buffer);
    await execFileAsync('/usr/bin/unzip', ['-o', '-q', tmpZip, '-d', tmpDir]);
    // manifest.json is usually at the root; tolerate one nested folder.
    let root = tmpDir;
    if (!existsSync(path.join(root, 'manifest.json'))) {
      const subs = await readdir(tmpDir, { withFileTypes: true });
      const sub = subs.find(
        (s) => s.isDirectory() && existsSync(path.join(tmpDir, s.name, 'manifest.json')),
      );
      if (sub) root = path.join(tmpDir, sub.name);
    }
    if (!existsSync(path.join(root, 'manifest.json')) || !existsSync(path.join(root, 'index.html'))) {
      throw new Error('not a valid widget package (missing manifest.json / index.html)');
    }
    const m = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    const id = sanitizeId(m.id || m.name);
    if (!id) throw new Error('manifest missing a usable id');
    const dest = path.join(INSTALLED, id);
    if (!dest.startsWith(INSTALLED + path.sep)) throw new Error('invalid widget id');
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await execFileAsync('/bin/cp', ['-R', `${root}/.`, dest]);
    return await meta(id);
  } finally {
    await rm(tmpZip, { force: true }).catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function deletePlugin(id) {
  if (!ID_RE.test(id || '')) throw new Error('invalid id');
  const dest = path.join(INSTALLED, id);
  if (!dest.startsWith(INSTALLED + path.sep)) throw new Error('invalid id');
  await rm(dest, { recursive: true, force: true });
  return { id, deleted: true };
}
