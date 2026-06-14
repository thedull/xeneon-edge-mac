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
 ├─ src/touch.cjs          spawn the native touch driver, target the Edge display
 └─ src/server/server.mjs  HTTP + SSE on 127.0.0.1:8787
     ├─ routes.mjs         /api/* + /events
     └─ collectors/*.mjs   system · network · processes · media · ai-usage
native/xeneon-touch/       Swift HID→click driver (Corsair Edge touch on macOS)
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
npm start                       # framed window (traffic-light controls), auto-targets the Edge
npm run kiosk                   # true fullscreen, no chrome / no menu (XEM_KIOSK=1)
npm run kiosk:primary           # force the window onto the primary display (no Edge needed)

# Packaged .app WITH working touch input (see "Touch input" below):
npm run app                     # build + sign + launch dist/mac-arm64/Xeneon Edge.app

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

- **Must** — YouTube player + collapsible search (**keyless** — host scrapes results, no API key) ✓ · System stats as **live area charts** (CPU%, real Memory Used via `vm_stat`, Disk%, network) ✓
- **Should** — Apple Music miniplayer + volume ✓ · **Native touchscreen support** (WCH HID → mapped clicks, see below) ✓
- **Could** — Top processes ✓
- **Would** — ai-usage-monitor integration (+ mock) ✓ · community `.icuewidget` support (next phase, see below)

## Display & window modes

- The app **auto-targets the Edge** (matched by 2560×720 in points or native pixels, or 32:9 aspect) and re-pins to it on hotplug — no manual moving.
- Default window is **framed** (movable/resizable, traffic-light controls). `npm run kiosk` (or `XEM_KIOSK=1`) runs true fullscreen with no chrome/menu.
- `XEM_DISABLE_MEDIA=1` skips Apple Music polling (avoids the Automation prompt during headless dev).

## Touch input

macOS has **no native touchscreen support** — it never maps an external panel's
touch reports to that display. Out of the box, a tap on the Edge just moves the
global cursor and clicks wherever it already is (usually your *other* display).
This project ships a small native driver that fixes that, mapping touches to real
clicks **on the Edge**.

### How it works

`native/xeneon-touch` is a small Swift user-space helper:

1. The Edge's touch panel is a **separate embedded WCH controller** (USB
   `0x27C0/0x0859`, product `"TouchScreen"`) — *not* the Corsair "XENEON EDGE"
   device (`0x1B1C/0x1D0D`), which only carries the widget/control channel.
2. It **seizes** that device via `IOHIDManager` (exclusive open), which stops
   macOS from emitting its own stray cursor movement (the wrong-display clicks).
3. It reads absolute coordinates — **X** = GenericDesktop usage `0x30` (`0..16383`),
   **Y** = usage `0x31` (`0..9599`), finger **contact** = Button-1 (`page 0x09 /
   usage 0x01`); the panel is effectively an absolute-coordinate mouse. Logical
   ranges are read from the HID elements at runtime.
4. It maps the normalized point onto the Edge display's `CGDisplayBounds` and
   injects a real `leftMouse` move/down/drag/up via `CGEventPost`.

`src/touch.cjs` spawns the helper from the Electron main process, passes
`--display-id` for the matched Edge display (correct mapping in multi-monitor
layouts), restarts it on display hotplug, and kills it on quit.

### Permissions

The helper needs two one-time macOS grants, attached to the **app** that spawns it
(the TCC "responsible process"):

- **Input Monitoring** — to read the HID device. *No auto-prompt for a
  touchscreen* — add the app manually with the `+` button, then enable it.
- **Accessibility** — to inject clicks.

TCC keys ad‑hoc‑signed apps by code hash, so every rebuild would otherwise reset
these grants. `scripts/dev-cert.sh` creates a **stable self‑signed code‑signing
certificate** (`"Xeneon Edge Dev"`) so the app's identity — and its grants —
survive rebuilds; `npm run app` uses it automatically when present.

### Build & run

```bash
bash scripts/dev-cert.sh   # one-time: stable signing identity so grants persist
npm run build:touch        # compile the Swift helper → sidecars/xeneon-touch
npm run app                # build + sign + launch dist/mac-arm64/Xeneon Edge.app
```

On first launch, grant **Input Monitoring** + **Accessibility** to "Xeneon Edge",
then relaunch (`npm run app`). The packaged `.app` is the supported way to run
touch: a LaunchServices-launched app is its own responsible process, whereas a
terminal-launched `npm start` attributes the grants to the *terminal* instead.

### Troubleshooting (`XEM_TOUCH_ARGS="…"` forwards flags to the helper)

| Symptom | Fix |
|---|---|
| See what's happening | `tail -f ~/Library/Logs/xeneon-touch.log` — open result, matched devices, a `touch DOWN … axTrusted=…` line per tap |
| Which device / usages? | `./sidecars/xeneon-touch --list` enumerates all HID devices |
| Inspect raw reports | `XEM_TOUCH_ARGS="--verbose"` dumps the first 80 HID elements (page/usage/value/range) |
| `matched 0 devices` | Input Monitoring isn't granted to the running app yet |
| Clicks mirrored/offset | `XEM_TOUCH_ARGS="--flip-x"` and/or `--flip-y` |
| VID/PID changed (hw revision) | `XEM_TOUCH_ARGS="--vid 0x… --pid 0x…"` (find via `--list`) |
| Double-tap when other display has focus | handled by the window's `acceptFirstMouse`; embedded iframes (YouTube/Music) may still need one focus tap |
| `Killed: 9` on the staged binary | `cp` invalidates the ad-hoc signature on Apple Silicon; `build-touch.sh` re-signs the copy — just rebuild |
| Turn it off | `XEM_NO_TOUCH=1` |

### Known limitations

- Single-pointer only (no multi-finger gestures) — matches the macOS click model.
- The ad-hoc / self-signed build is for **local use**; distribution needs a real
  Developer ID + notarization for both the helper and the app.

## Roadmap

- Native sidecar (`sidecars/`, JSON‑over‑stdout) for CPU/GPU temps.
- Tauri host (rewrite `src/server` + collectors in Rust; keep `web/` + the API contract).

## Next phase: iCUE widget support (planned — not yet built)

Corsair's Windows‑only iCUE lets users drop third‑party **widgets** onto the Edge.
The next phase is to run those community widgets on macOS through this host, so the
Edge gets the same ecosystem Windows users have. The touch + dashboard work above
is the foundation it sits on.

Scope to define when we pick it up:

- **Package format** — inspect a real `.icuewidget` (reportedly a zip of
  HTML/CSS/JS + a manifest). Document the manifest schema and asset layout.
- **Runtime shim** — load widgets into `web/plugins/installed/` (already
  git‑ignored) and render them in the tile grid like the built‑in widgets.
- **API bridge** — map the iCUE widget JS API (sensor feeds, etc.) onto our
  `/api/*` + SSE contract, or shim the iCUE global it expects.
- **Sensors** — many widgets want CPU/GPU temps; pair with the planned native
  `sidecars/` temp provider.
- **Sandboxing** — third‑party code runs in the existing per‑widget iframe
  isolation; decide which host APIs (if any) to expose.
