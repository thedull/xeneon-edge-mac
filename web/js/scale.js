// scale.js — fit the fixed 2560x720 stage into the current window, preserving
// aspect. Sets the --dashboard-scale CSS var used by the dashboard stage.
export function applyScale(targetW = 2560, targetH = 720) {
  function set() {
    const s = Math.min(window.innerWidth / targetW, window.innerHeight / targetH);
    document.documentElement.style.setProperty('--dashboard-scale', String(s));
  }
  set();
  window.addEventListener('resize', set);
  return set;
}
