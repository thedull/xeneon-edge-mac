// preload.cjs — reserved seam for exposing host capabilities to widgets.
// The API origin is currently passed via ?api= on the dashboard URL (set in
// main.cjs) and read by web/js/host-bridge.js, so no bridge is required yet.
// Kept as an explicit, documented extension point for future native features.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('xemHost', {
  platform: process.platform,
  version: process.versions.electron,
});
