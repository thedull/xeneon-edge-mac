# xeneon-touch — native touch driver

macOS has **no native touchscreen-to-display mapping**. The Corsair Xeneon Edge
enumerates as a USB HID device with two relevant top-level collections:

- a **mouse-emulation** collection — macOS turns this into stray *global* cursor
  movement, so a tap fires a click wherever the cursor already is (typically your
  *other* display); and
- a real **digitizer** collection (`UsagePage 0x0D`) that reports absolute X/Y.

`xeneon-touch` is a small Swift user-space helper that fixes this:

1. **Seizes** (exclusive-opens) both collections via `IOHIDManager`. Seizing stops
   macOS double-handling the device — which kills the wrong-display cursor jump.
2. Reads absolute touch **X/Y + tip-switch** from the digitizer, reading each
   axis' logical range from the HID element at runtime (no hardcoded ranges).
3. Maps the normalized point onto the Edge display's global bounds and injects
   `leftMouse` move/down/drag/up via **`CGEventPost`**.

It is matched to this unit by **VID `0x1B1C` / PID `0x1D0D`** (Corsair "XENEON
EDGE"). Override with `--vid` / `--pid` if a future revision differs.

## Build

```sh
npm run build:touch     # → sidecars/xeneon-touch (staged for dev + packaging)
```

Requires the Swift toolchain (Xcode Command Line Tools). The Electron main process
(`src/touch.cjs`) spawns the staged binary automatically, passing `--display-id`
for the matched Edge display so touches map correctly in multi-monitor layouts.

## Permissions (one-time, per machine)

Both attach to the **responsible process** — the app that spawns the helper:

- **Input Monitoring** — to capture HID input. System Settings ▸ Privacy &
  Security ▸ Input Monitoring.
- **Accessibility** — to inject clicks. System Settings ▸ Privacy & Security ▸
  Accessibility.

In dev, grant **Electron** (the dev host launching the app). In the packaged app,
grant **Xeneon Edge**. After granting, restart the app. If **iCUE** or another
process holds the device, quit it first (it can take exclusive HID access).

## Runtime flags (via env)

`src/touch.cjs` honors:

- `XEM_NO_TOUCH=1` — disable the driver entirely.
- `XEM_TOUCH_ARGS="--flip-y"` — pass extra flags (axis flips for a mirrored/rotated
  panel, `--verbose` to log every HID element + posted event, `--no-seize-mouse`).

## Known limitations

- Single-pointer click model only (no multi-finger gestures) — matches the macOS
  cursor model. Multi-touch reports collapse to the first contact.
- Two-finger/scroll gestures are not synthesized.
