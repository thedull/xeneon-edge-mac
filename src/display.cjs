// display.cjs — locate the Xeneon Edge (2560x720) among connected displays and
// resolve the kiosk window target. Falls back to a 2560x720 window on the
// primary display (for development/demo without the physical Edge).
const { screen } = require('electron');

const EDGE_W = 2560;
const EDGE_H = 720;

function findEdgeDisplay() {
  const displays = screen.getAllDisplays();
  return (
    displays.find((d) => d.size.width === EDGE_W && d.size.height === EDGE_H) || null
  );
}

function edgeWindowOnPrimary(primary) {
  // Place a 2560x720 window at the primary's work-area origin so the layout
  // renders at the true target resolution even on a smaller laptop screen.
  const wa = primary.workArea;
  return { x: wa.x, y: wa.y, width: EDGE_W, height: EDGE_H };
}

// { display, bounds, found, forced }
function resolveTarget({ forcePrimary = false } = {}) {
  if (!forcePrimary) {
    const edge = findEdgeDisplay();
    if (edge) return { display: edge, bounds: edge.bounds, found: true, forced: false };
  }
  const primary = screen.getPrimaryDisplay();
  return {
    display: primary,
    bounds: edgeWindowOnPrimary(primary),
    found: false,
    forced: forcePrimary,
  };
}

function displayInfo(target) {
  if (!target) return { found: false };
  return {
    found: target.found,
    forced: target.forced,
    width: target.bounds.width,
    height: target.bounds.height,
    id: target.display.id,
  };
}

module.exports = { findEdgeDisplay, resolveTarget, displayInfo, EDGE_W, EDGE_H };
