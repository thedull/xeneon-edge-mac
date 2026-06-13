# Xeneon Edge (macOS)

A macOS widget dashboard for the **Corsair Xeneon Edge** (14.5″ 2560×720 USB‑C
touchscreen) — a Mac‑native alternative to Corsair's Windows‑only iCUE Widgets.

The Edge is just an external display on macOS, so this app is a small **host**:
the Electron main process runs a local HTTP + SSE server that serves
self‑contained web widgets and feeds them Mac‑native data (system stats via
`os`/`ps`/`df`/`netstat`, Apple Music via AppleScript). Widgets are plain web
pages with **zero Electron coupling**, so the same `web/` folder can later run
under a Tauri host unchanged.

## Architecture

```
Electron main (src/main.cjs)
 ├─ src/display.cjs        find the Edge (2560x720) display / fallback to primary
 └─ src/server/server.mjs  HTTP + SSE on 127.0.0.1:8787
     ├─ routes.mjs         /api/* + /events
     └─ collectors/*.mjs   system · network · processes · media · ai-usage
web/                       host-agnostic widgets (served to the kiosk window)
 ├─ dashboard.html         tile grid + swipe pagination
 ├─ widgets/*.html         youtube · system-monitor · media-player · processes · ai-usage
 └─ js/host-bridge.js      resolves the API origin (?api= → __HOST_API_BASE__ → origin)
```

### API contract (`http://127.0.0.1:8787`)

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ ok, capabilities, display }` |
| `GET /api/system` | `{ cpu, ram, ramUsedMB, ramTotalMB, disk, ... }` |
| `GET /api/network` | `{ download, upload, downloadHuman, uploadHuman, iface }` |
| `GET /api/processes?limit=N` | `{ processes:[{pid,name,user,cpu,memMB,memPercent}] }` |
| `GET /api/media` | `{ available, playerState, title, artist, artworkId, positionSec, durationSec, volume }` |
| `GET /api/media/artwork` | current track image |
| `POST /api/media/{playpause,next,previous,volume}` | fresh media snapshot |
| `GET /api/ai-usage` | `{ available, providers:[…], totalSpendUSD }` |
| `GET /events` | SSE: `system` `network` `media` `ai-usage` `ping` |

## Run

```bash
npm install

# Develop widgets in a browser (server only, deterministic fixtures):
XEM_FIXTURES=1 npm run dev      # → http://127.0.0.1:8787/dashboard.html

# Full Electron app on the Edge (or primary @2560x720 if the Edge isn't attached):
npm start
npm run kiosk:primary           # force the kiosk window onto the primary display

# Mock the (not-yet-built) ai-usage-monitor so the AI widget is demoable:
npm run mock:ai
```

## Test

```bash
npm run test:unit   # parser unit tests (node --test) — no browser needed
npm run test:e2e    # Playwright, widgets @2560x720, XEM_FIXTURES=1
npm test            # both
```

E2E runs against fixture-backed data (`XEM_FIXTURES=1`) so it's deterministic
with no real Edge, no live load, and no Music.app. The Electron smoke test can be
skipped with `XEM_SKIP_ELECTRON=1`.

## Feature status (MoSCoW)

- **Must** — YouTube player + collapsible search ✓ · System stats (RAM/CPU/disk/net) ✓
- **Should** — Apple Music miniplayer + volume ✓
- **Could** — Top processes ✓
- **Would** — ai-usage-monitor integration (+ mock) ✓ · community `.icuewidget` shim (planned)

## Roadmap

- Native sidecar (`sidecars/`, JSON‑over‑stdout) for CPU/GPU temps.
- Community `.icuewidget` plugin shim (`web/plugins/`).
- Tauri host (rewrite `src/server` + collectors in Rust; keep `web/` + the API contract).
