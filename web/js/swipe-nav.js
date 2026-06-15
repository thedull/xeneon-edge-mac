// swipe-nav.js — detect swipes inside a widget iframe and forward the intent to
// the dashboard via postMessage. Pointer events inside an iframe don't bubble to
// the parent stage, so each widget page installs this to report swipes.
//
//   horizontal swipe → { type: 'nav:swipe', dir: 'next' | 'prev' }   (change page)
//   vertical swipe   → { type: 'source:switch', dir: 'up' | 'down' } (only when
//                       axes includes 'vertical' — used by the Apple Music pane)
//
// The native touch driver injects real mouse/pointer events, so we listen on
// Pointer Events and never preventDefault — vertical scroll, native <video>
// controls, taps, and the media seek/volume drags must keep working.

export function isHorizontalSwipe(dx, dy, threshold, ratio) {
  return Math.abs(dx) > threshold && Math.abs(dx) > ratio * Math.abs(dy);
}

function isVerticalSwipe(dx, dy, threshold, ratio) {
  return Math.abs(dy) > threshold && Math.abs(dy) > ratio * Math.abs(dx);
}

export function installSwipeNav({
  target = document,
  threshold = 80,
  ratio = 1.3,
  ignore = null,
  axes = ['horizontal'],
} = {}) {
  // Only meaningful inside a frame — the top-level dashboard handles its own.
  if (typeof window === 'undefined' || window.parent === window) return null;

  let startX = null;
  let startY = null;
  let ignored = false;

  const onDown = (e) => {
    if (!e.isPrimary) return;
    ignored = !!(ignore && e.target.closest && e.target.closest(ignore));
    startX = e.clientX;
    startY = e.clientY;
  };

  const onUp = (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    startX = startY = null;
    if (ignored) return;
    if (axes.includes('horizontal') && isHorizontalSwipe(dx, dy, threshold, ratio)) {
      window.parent.postMessage({ type: 'nav:swipe', dir: dx < 0 ? 'next' : 'prev' }, '*');
    } else if (axes.includes('vertical') && isVerticalSwipe(dx, dy, threshold, ratio)) {
      window.parent.postMessage({ type: 'source:switch', dir: dy < 0 ? 'up' : 'down' }, '*');
    }
  };

  const onCancel = () => {
    startX = startY = null;
  };

  target.addEventListener('pointerdown', onDown, { passive: true });
  target.addEventListener('pointerup', onUp, { passive: true });
  target.addEventListener('pointercancel', onCancel, { passive: true });

  return {
    destroy() {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    },
  };
}
