// display-match.cjs — pure Edge-display matching logic, with no `electron`
// dependency so it can be unit-tested directly. display.cjs wraps this with the
// live `screen` API.
const EDGE_W = 2560;
const EDGE_H = 720;
const EDGE_AR = EDGE_W / EDGE_H; // 3.555…

// Does this display (Electron Display shape: {size:{width,height}, scaleFactor,
// internal, bounds}) look like the Xeneon Edge?
function isEdgeDisplay(d) {
  if (!d || !d.size) return false;
  const { width, height } = d.size;
  const sf = d.scaleFactor || 1;
  const pxW = Math.round(width * sf);
  const pxH = Math.round(height * sf);
  // exact match in points or in native pixels (covers scaled/HiDPI modes)
  if ((width === EDGE_W && height === EDGE_H) || (pxW === EDGE_W && pxH === EDGE_H)) {
    return true;
  }
  // aspect-ratio fallback: a very wide, short, external panel
  const ar = width / height;
  if (Math.abs(ar - EDGE_AR) < 0.06 && !d.internal && height <= 900) {
    return true;
  }
  return false;
}

function isExactEdge(d) {
  const sf = d.scaleFactor || 1;
  return (
    (d.size.width === EDGE_W && d.size.height === EDGE_H) ||
    (Math.round(d.size.width * sf) === EDGE_W && Math.round(d.size.height * sf) === EDGE_H)
  );
}

// Prefer an exact (point/pixel) match over an aspect-ratio guess.
function findEdgeDisplay(displays = []) {
  return displays.find(isExactEdge) || displays.find(isEdgeDisplay) || null;
}

function edgeWindowOnPrimary(primary) {
  const wa = primary.workArea;
  return { x: wa.x, y: wa.y, width: EDGE_W, height: EDGE_H };
}

module.exports = { isEdgeDisplay, findEdgeDisplay, edgeWindowOnPrimary, EDGE_W, EDGE_H };
