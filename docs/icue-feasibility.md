# iCUE widget compatibility — feasibility spike

**Verdict: GO.** Unmodified Corsair/Elgato `.icuewidget` packages run on this macOS
host through a thin compatibility shim, with our data flowing in. Two real
community widgets (built with Corsair's official WidgetBuilder CLI) were tested:

| Widget | Type | Result |
|---|---|---|
| StealthyLabsHQ **Windows Media Pump** | `pump_lcd`, `required_plugins: mediadataprovider` | Rendered **our** Apple Music now-playing ("Redbone / Childish Gambino" from `/api/media`) via the shimmed Media plugin. `iCUE_initialized: true`, **0 errors**. |
| StealthyLabsHQ **Weather Now** | `dashboard_lcd`, `interactive` | Full-fidelity render at tile size (live Open-Meteo data, proper styling). `iCUE_initialized: true`, **0 errors**. |

Screenshots: `/tmp/icue-media-widget.png`, `/tmp/icue-weather-widget.png` (spike run).

## How it works (what we built)

- **`web/plugins/runtime/icue-shim.js`** — a dependency-free classic script that
  recreates the iCUE runtime widgets expect: `window.plugins.Mediadataprovider`
  (`.songName`/`.artist` + `getSongName(id)`/`getArtist(id)` replying through a
  Qt-style `.asyncResponse` signal), `window.plugins.Sensorsdataprovider`
  (`.sensorValueChanged(id,value)`), `window.iCUE` / `window.iCUE_initialized`,
  the `x-icue-property` default globals, `tr()`, and the lifecycle hooks
  (`pluginMediadataproviderEvents.onInitialized`, `icueEvents.onICUEInitialized` /
  `onDataUpdated`). It polls `/api/media` and `/api/system` to drive them.
- **Server injection** (`src/server/server.mjs`) — any `.html` under
  `/plugins/installed/` gets the shim injected as the first `<head>` script (same
  on-the-fly rewrite trick as the HLS playlist). Same-origin, so the widgets'
  strict CSP (`script-src 'self'; connect-src 'self'`) is satisfied — no relaxing
  needed.
- **`web/plugins/test.html`** — harness to load an installed widget in an iframe.

## What mapped cleanly
- **Package format**: `.icuewidget` is a ZIP of `index.html` + `manifest.json` +
  `scripts/` (incl. a bundled `icue-events-bridge.js` stub) + `styles/` +
  `resources/` + `translation.json`. Unzipping into `web/plugins/installed/<id>/`
  is all the "install" needed.
- **Media plugin** → `/api/media` (1:1).
- **CSP**: the widgets' `'self'` policy works *for* us since the shim and `/api/*`
  are same-origin. No injection of inline script required.
- **`os: ["windows"]`** manifest gate is irrelevant — our loader just serves files;
  nothing enforces it.
- **Lifecycle**: injecting before the widget's scripts + firing hooks on
  `DOMContentLoaded` matches the spec's ordering; widgets also self-start.

## Gaps / limitations (inform the full-loader scope)
- **Sensors catalog**: macOS exposes far fewer sensors than iCUE's hardware
  catalog (no GPU temp / fan RPM / voltages today). Widgets bound to arbitrary
  hardware sensors will have no data until a **native sensor bridge** lands. We map
  `cpu.load`, `mem.used`, `disk.used`.
- **Settings UI**: we apply `x-icue-property` *defaults* only — no settings panel
  yet, so widgets needing user-selected sensors/options run on defaults. Full
  parity needs the control types (slider, color, sensors-combobox, …).
- **`window.iCUE` global**: only common methods stubbed; the full reference
  (docs.elgato.com `icue-global-object`) should be filled in as widgets demand.
- **Media async path**: implemented both the direct props and `getX(id)`+
  `asyncResponse` patterns; other media widgets may use more methods (album art,
  position) — extend as needed.

## Recommended scope for the real feature (post-spike)
1. **Import wizard**: drag-drop a `.icuewidget` → unzip into
   `web/plugins/installed/<id>/`, read `manifest.json`, register a tile.
2. **Widget registry + grid integration**: dynamic tiles from installed widgets
   (sized per `supported_devices` slot), persisted in config.
3. **Settings panel**: render `x-icue-property` controls; persist per-widget config
   (localStorage namespace already exists).
4. **Sensor bridge**: pair with the planned native CPU/GPU-temp sidecar to widen
   the sensor catalog (the main data gap).
5. Fill out `window.iCUE` + Media/Sensors plugin methods as real marketplace
   widgets exercise them.

## Strategic note
This validates the **moat**: be the macOS runtime for Corsair's *own* (Windows-only)
widget ecosystem. The format is open and the bridge is small — the durable work is
the sensor bridge + settings UI, not the core compatibility.
