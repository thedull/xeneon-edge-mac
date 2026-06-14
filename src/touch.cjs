// touch.cjs — manage the native `xeneon-touch` helper that turns Xeneon Edge
// touches into real macOS clicks mapped to the panel's display. macOS has no
// native touchscreen mapping, so without this the panel's touch reports move the
// global cursor and clicks land on whatever display the cursor is on.
//
// The helper is a separate process because HID seizing + CGEvent injection need
// Input Monitoring + Accessibility, which are cleaner to reason about (and grant)
// in a small dedicated binary than across all of Electron.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function resolveBinary() {
  const candidates = [
    // packaged app: bundled via electron-builder extraResources
    process.resourcesPath && path.join(process.resourcesPath, 'xeneon-touch'),
    // dev: staged by `npm run build:touch`
    path.join(__dirname, '..', 'sidecars', 'xeneon-touch'),
    // dev fallback: straight from the SwiftPM build dir
    path.join(__dirname, '..', 'native', 'xeneon-touch', '.build', 'release', 'xeneon-touch'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// getEdgeDisplayId: () => CGDirectDisplayID (Electron Display.id is the CGDirect-
// DisplayID on macOS), or 0/undefined to let the helper auto-detect the 2560x720
// panel. Extra args (e.g. ['--flip-y']) come from env for field tweaking.
function createTouchDriver({ getEdgeDisplayId } = {}) {
  const enabled = process.platform === 'darwin' && process.env.XEM_NO_TOUCH !== '1';
  const bin = enabled ? resolveBinary() : null;
  const extraArgs = (process.env.XEM_TOUCH_ARGS || '').split(/\s+/).filter(Boolean);

  let child = null;
  let currentId = null;
  let stopped = false;
  let lastSpawn = 0;
  let fastExits = 0;

  const log = (...a) => console.log('[xem][touch]', ...a);

  const edgeId = () => {
    try {
      return (getEdgeDisplayId && getEdgeDisplayId()) || 0;
    } catch {
      return 0;
    }
  };

  function spawnFor(id) {
    currentId = id;
    lastSpawn = Date.now();
    const args = ['--display-id', String(id || 0), ...extraArgs];
    log(`launching helper (display=${id || 'auto'})`);
    child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (e) => log('helper failed to launch:', e.message));
    child.on('exit', (code, sig) => {
      child = null;
      if (stopped) return;
      // SIGTERM is our own retarget/stop; anything else is a crash/exit we retry.
      if (sig === 'SIGTERM') return;
      fastExits = Date.now() - lastSpawn < 3000 ? fastExits + 1 : 0;
      const delay = Math.min(30000, 2000 * 2 ** Math.min(fastExits, 4));
      if (fastExits >= 1) {
        log(`helper exited (code=${code} sig=${sig}); retrying in ${delay}ms`);
      }
      setTimeout(() => {
        if (!stopped) spawnFor(currentId);
      }, delay);
    });
  }

  return {
    start() {
      if (!enabled) return;
      if (!bin) {
        log('helper binary not found — run `npm run build:touch` to enable Edge touch input.');
        return;
      }
      spawnFor(edgeId());
    },
    // Re-point at the Edge after a display hotplug/rearrange.
    retarget() {
      if (!enabled || !bin) return;
      const id = edgeId();
      if (child && id === currentId) return; // nothing changed
      if (child) child.kill('SIGTERM'); // exit handler is a no-op for SIGTERM; respawn below
      spawnFor(id);
    },
    stop() {
      stopped = true;
      if (child) {
        child.kill('SIGTERM');
        child = null;
      }
    },
  };
}

module.exports = { createTouchDriver };
