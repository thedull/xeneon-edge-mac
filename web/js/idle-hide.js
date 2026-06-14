// idle-hide.js — hide UI affordances after a period of inactivity and bring
// them back on the next interaction. Used for the dashboard nav arrows and the
// YouTube toolbar so the touchscreen stays uncluttered while idle.
//
// idleHide(els, { timeoutMs, root, onShow, onHide }) → { show, hide, kick, stop }
// - `els` is an element or array of elements that get the `idle-hidden` class.
// - activity on `root` (default document) resets the timer and reshows.
export function idleHide(els, { timeoutMs = 30000, root = document, onShow, onHide } = {}) {
  const targets = (Array.isArray(els) ? els : [els]).filter(Boolean);
  let timer = 0;
  let hidden = false;

  function hide() {
    if (hidden) return;
    hidden = true;
    for (const el of targets) el.classList.add('idle-hidden');
    onHide?.();
  }

  function show() {
    if (hidden) {
      hidden = false;
      for (const el of targets) el.classList.remove('idle-hidden');
      onShow?.();
    }
  }

  function kick() {
    show();
    clearTimeout(timer);
    timer = setTimeout(hide, timeoutMs);
  }

  const onActivity = () => kick();
  for (const evt of ['pointerdown', 'touchstart', 'keydown', 'mousemove']) {
    root.addEventListener(evt, onActivity, { passive: true });
  }
  kick(); // start visible, arm the timer

  return {
    show,
    hide,
    kick,
    stop() {
      clearTimeout(timer);
      for (const evt of ['pointerdown', 'touchstart', 'keydown', 'mousemove']) {
        root.removeEventListener(evt, onActivity);
      }
    },
  };
}
