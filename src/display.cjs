// display.cjs — locate the Xeneon Edge among connected displays and resolve the
// kiosk window target, using the live Electron `screen` API. Pure matching logic
// lives in display-match.cjs (unit-tested without Electron).
const { screen } = require('electron');
const {
  isEdgeDisplay,
  findEdgeDisplay: matchEdge,
  edgeWindowOnPrimary,
  EDGE_W,
  EDGE_H,
} = require('./display-match.cjs');

function findEdgeDisplay() {
  return matchEdge(screen.getAllDisplays());
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

module.exports = {
  isEdgeDisplay,
  findEdgeDisplay,
  resolveTarget,
  displayInfo,
  edgeWindowOnPrimary,
  EDGE_W,
  EDGE_H,
};
