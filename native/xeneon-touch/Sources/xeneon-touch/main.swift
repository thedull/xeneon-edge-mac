// xeneon-touch — user-space touch driver for the Corsair Xeneon Edge on macOS.
//
// macOS has no native touchscreen-to-display mapping. The Edge enumerates as a
// USB HID device with two relevant top-level collections: a mouse-emulation
// collection (which macOS turns into stray global-cursor movement, landing
// clicks on whatever display the cursor happens to be on) and a real *digitizer*
// collection that reports absolute X/Y. This helper:
//
//   1. Seizes (exclusive-opens) both collections via IOHIDManager, which stops
//      macOS double-handling the device — killing the wrong-display cursor jump.
//   2. Reads absolute touch X/Y + tip-switch from the digitizer collection,
//      reading each axis' logical range from the HID element at runtime.
//   3. Maps the normalized touch point onto the Edge display's global bounds and
//      injects synthetic left mouse move/down/drag/up via CGEventPost.
//
// Requires Input Monitoring (HID capture) and Accessibility (event injection).
// Both attach to the responsible process — when spawned by the Electron app,
// grant the app (or its dev host) those two permissions in System Settings.

import Foundation
import IOKit
import IOKit.hid
import CoreGraphics
import ApplicationServices

// HID usage constants we care about.
private let kPageGenericDesktop = 0x01
private let kPageButton = 0x09
private let kPageDigitizer = 0x0D
private let kUsageX = 0x30
private let kUsageY = 0x31
private let kUsageMouse = 0x02
private let kUsageButton1 = 0x01
private let kUsageTipSwitch = 0x42

// Logs go to stderr *and* a file, because when the packaged app spawns this
// helper its stderr is invisible. Tail it with:
//   tail -f ~/Library/Logs/xeneon-touch.log
let logURL = URL(fileURLWithPath: NSHomeDirectory() + "/Library/Logs/xeneon-touch.log")
func initLog() {
  FileManager.default.createFile(atPath: logURL.path, contents: Data())
}
func elog(_ s: String) {
  let line = "[xeneon-touch] " + s + "\n"
  FileHandle.standardError.write(Data(line.utf8))
  if let h = try? FileHandle(forWritingTo: logURL) {
    h.seekToEndOfFile()
    h.write(Data(line.utf8))
    h.closeFile()
  }
}

// Human-readable summary of an HID device's identity.
func deviceInfo(_ d: IOHIDDevice) -> String {
  func prop(_ k: String) -> Any? { IOHIDDeviceGetProperty(d, k as CFString) }
  let vid = (prop(kIOHIDVendorIDKey) as? Int) ?? -1
  let pid = (prop(kIOHIDProductIDKey) as? Int) ?? -1
  let up = (prop(kIOHIDPrimaryUsagePageKey) as? Int) ?? -1
  let u = (prop(kIOHIDPrimaryUsageKey) as? Int) ?? -1
  let product = (prop(kIOHIDProductKey) as? String) ?? "?"
  let transport = (prop(kIOHIDTransportKey) as? String) ?? "?"
  return "vid=0x\(String(vid, radix: 16)) pid=0x\(String(pid, radix: 16)) primaryUsage=0x\(String(up, radix: 16))/0x\(String(u, radix: 16)) product=\"\(product)\" transport=\(transport)"
}

// `--list`: enumerate every HID device the manager can see (metadata only — does
// not require Input Monitoring) and exit. Use to confirm the panel is matchable.
func listDevices() {
  let m = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
  IOHIDManagerSetDeviceMatching(m, nil)
  let devices = (IOHIDManagerCopyDevices(m) as? Set<IOHIDDevice>) ?? []
  elog("--- HID devices visible (\(devices.count)) ---")
  for d in devices.sorted(by: { ("\($0)" < "\($1)") }) {
    elog("  " + deviceInfo(d))
  }
}

// ---- Config / argument parsing -------------------------------------------------

struct Config {
  // The Edge's touch panel is a separate embedded WCH touch controller (product
  // "TouchScreen") — NOT the Corsair "XENEON EDGE" vendor device (0x1B1C/0x1D0D),
  // which only carries the control/widget channel. The digitizer lives here:
  var vendorID = 0x27C0          // WCH (wch.cn)
  var productID = 0x0859         // "TouchScreen" digitizer + mouse-emulation
  var displayID: CGDirectDisplayID = 0   // 0 = auto-detect the 2560x720 panel
  var flipX = false
  var flipY = false
  var seizeMouse = true
  var verbose = false
  var listOnly = false
}

func parseArgs() -> Config {
  var c = Config()
  var it = CommandLine.arguments.dropFirst().makeIterator()
  func nextInt() -> Int? { it.next().flatMap { Int($0) } ?? nil }
  while let a = it.next() {
    switch a {
    case "--vid": if let v = it.next() { c.vendorID = Int(v.dropFirst(v.hasPrefix("0x") ? 2 : 0), radix: v.hasPrefix("0x") ? 16 : 10) ?? c.vendorID }
    case "--pid": if let v = it.next() { c.productID = Int(v.dropFirst(v.hasPrefix("0x") ? 2 : 0), radix: v.hasPrefix("0x") ? 16 : 10) ?? c.productID }
    case "--display-id": if let v = it.next(), let n = UInt32(v) { c.displayID = n }
    case "--flip-x": c.flipX = true
    case "--flip-y": c.flipY = true
    case "--no-seize-mouse": c.seizeMouse = false
    case "--verbose", "-v": c.verbose = true
    case "--list": c.listOnly = true
    case "--help", "-h":
      print("""
      xeneon-touch — Corsair Xeneon Edge touch driver
        --vid <id>        Vendor ID  (default 0x1B1C)
        --pid <id>        Product ID (default 0x1D0D)
        --display-id <n>  CGDirectDisplayID to map touches onto (default: auto 2560x720)
        --flip-x / --flip-y  Invert an axis if the panel is mirrored/rotated
        --no-seize-mouse  Don't seize the mouse-emulation collection
        --verbose         Log every HID element + posted event
      """)
      exit(0)
    default: elog("ignoring unknown arg: \(a)")
    }
  }
  return c
}

// ---- Touch → CGEvent bridge ----------------------------------------------------

final class TouchBridge {
  let cfg: Config
  let source = CGEventSource(stateID: .hidSystemState)
  var fx = 0.0, fy = 0.0         // normalized 0..1
  var down = false

  init(_ cfg: Config) { self.cfg = cfg }

  // Global bounds (points, top-left origin) of the display we map touches onto.
  func targetBounds() -> CGRect {
    if cfg.displayID != 0 {
      let b = CGDisplayBounds(cfg.displayID)
      if b.width > 1 { return b }
    }
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    if count > 0 {
      var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
      CGGetActiveDisplayList(count, &ids, &count)
      for id in ids where CGDisplayPixelsWide(id) == 2560 && CGDisplayPixelsHigh(id) == 720 {
        return CGDisplayBounds(id)
      }
    }
    return CGDisplayBounds(CGMainDisplayID())
  }

  func point() -> CGPoint {
    let b = targetBounds()
    let x = cfg.flipX ? 1 - fx : fx
    let y = cfg.flipY ? 1 - fy : fy
    return CGPoint(x: b.minX + min(max(x, 0), 1) * b.width,
                   y: b.minY + min(max(y, 0), 1) * b.height)
  }

  func post(_ type: CGEventType) {
    let p = point()
    if let ev = CGEvent(mouseEventSource: source, mouseType: type,
                        mouseCursorPosition: p, mouseButton: .left) {
      ev.post(tap: .cghidEventTap)
      if cfg.verbose { elog("post \(type.rawValue) @ \(Int(p.x)),\(Int(p.y)) down=\(down)") }
    }
  }

  func updateAxis(x: Double?, y: Double?) {
    if let x { fx = x }
    if let y { fy = y }
    if down { post(.leftMouseDragged) }
  }

  func tip(_ on: Bool) {
    if on && !down {
      down = true
      let p = point()
      // One line per tap — confirms touch reception AND live Accessibility state.
      elog("touch DOWN norm=(\(String(format: "%.3f", fx)),\(String(format: "%.3f", fy))) → screen=(\(Int(p.x)),\(Int(p.y))) axTrusted=\(AXIsProcessTrusted())")
      post(.mouseMoved)   // park the cursor on the touch point first
      post(.leftMouseDown)
    } else if !on && down {
      down = false
      elog("touch UP")
      post(.leftMouseUp)
    }
  }
}

// First-N raw element dump — reveals the panel's actual report layout (which
// usage pages/usages carry X/Y/tip, and whether they're relative) so we can map
// it correctly. Resets are unnecessary; 80 events is enough to see a tap.
var diagN = 0

// C callbacks can't capture context, so recover the bridge from the opaque ptr.
let inputCallback: IOHIDValueCallback = { context, _, _, value in
  guard let context else { return }
  let bridge = Unmanaged<TouchBridge>.fromOpaque(context).takeUnretainedValue()
  let element = IOHIDValueGetElement(value)
  let page = Int(IOHIDElementGetUsagePage(element))
  let usage = Int(IOHIDElementGetUsage(element))
  let raw = IOHIDValueGetIntegerValue(value)

  if bridge.cfg.verbose && diagN < 80 {
    diagN += 1
    let rel = IOHIDElementIsRelative(element) ? "rel" : "abs"
    elog("HID#\(diagN) page=0x\(String(page, radix: 16)) usage=0x\(String(usage, radix: 16)) val=\(raw) [\(rel)] range=\(IOHIDElementGetLogicalMin(element))..\(IOHIDElementGetLogicalMax(element))")
  }

  switch (page, usage) {
  case (kPageGenericDesktop, kUsageX), (kPageGenericDesktop, kUsageY):
    // Ignore the seized mouse collection's relative deltas — only the digitizer's
    // absolute axes carry a meaningful logical range.
    if IOHIDElementIsRelative(element) { return }
    let lo = IOHIDElementGetLogicalMin(element)
    let hi = IOHIDElementGetLogicalMax(element)
    guard hi > lo else { return }
    let n = Double(raw - lo) / Double(hi - lo)
    bridge.updateAxis(x: usage == kUsageX ? n : nil, y: usage == kUsageY ? n : nil)
  case (kPageDigitizer, kUsageTipSwitch), (kPageButton, kUsageButton1):
    // This panel reports finger contact as Button-1 (page 0x09/usage 0x01), not
    // a digitizer tip switch — it's effectively an absolute-coordinate mouse.
    bridge.tip(raw != 0)
  default:
    if bridge.cfg.verbose { elog("elem page=0x\(String(page, radix: 16)) usage=0x\(String(usage, radix: 16)) val=\(raw)") }
  }
}

// Seize matching devices as they arrive (covers USB hotplug).
let matchCallback: IOHIDDeviceCallback = { context, _, _, device in
  let r = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeSeizeDevice))
  let primPage = (IOHIDDeviceGetProperty(device, kIOHIDPrimaryUsagePageKey as CFString) as? Int) ?? -1
  elog("device matched (primaryUsagePage=0x\(String(primPage, radix: 16))) seize=\(r == kIOReturnSuccess ? "ok" : "err 0x\(String(r, radix: 16))")")
}

let removalCallback: IOHIDDeviceCallback = { _, _, _, _ in
  elog("device removed")
}

// ---- main ----------------------------------------------------------------------

let cfg = parseArgs()
initLog()
elog("starting — vid=0x\(String(cfg.vendorID, radix: 16)) pid=0x\(String(cfg.productID, radix: 16)) display=\(cfg.displayID == 0 ? "auto" : String(cfg.displayID)) seizeMouse=\(cfg.seizeMouse)")

if cfg.listOnly {
  listDevices()
  exit(0)
}

let bridge = TouchBridge(cfg)
let ctx = Unmanaged.passUnretained(bridge).toOpaque()

// Prompt for Accessibility (event injection) up front. CGEventPost is silently
// dropped until the responsible process is trusted.
let axOpts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(axOpts) {
  elog("WARNING: not trusted for Accessibility yet — clicks won't post until granted in System Settings ▸ Privacy & Security ▸ Accessibility, then restart.")
}

let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
var matches: [[String: Any]] = [[
  kIOHIDVendorIDKey: cfg.vendorID,
  kIOHIDProductIDKey: cfg.productID,
  kIOHIDDeviceUsagePageKey: kPageDigitizer,
]]
if cfg.seizeMouse {
  // Seize (but otherwise ignore) the device's own mouse collection so macOS stops
  // jerking the global cursor. Matched by VID/PID so real mice are untouched.
  matches.append([
    kIOHIDVendorIDKey: cfg.vendorID,
    kIOHIDProductIDKey: cfg.productID,
    kIOHIDDeviceUsagePageKey: kPageGenericDesktop,
    kIOHIDDeviceUsageKey: kUsageMouse,
  ])
}
IOHIDManagerSetDeviceMatchingMultiple(manager, matches as CFArray)
IOHIDManagerRegisterInputValueCallback(manager, inputCallback, ctx)
IOHIDManagerRegisterDeviceMatchingCallback(manager, matchCallback, ctx)
IOHIDManagerRegisterDeviceRemovalCallback(manager, removalCallback, ctx)
IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)

let openResult = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeSeizeDevice))
elog("IOHIDManagerOpen(seize) = 0x\(String(openResult, radix: 16)) (\(openResult == kIOReturnSuccess ? "success" : "error"))")
if openResult != kIOReturnSuccess {
  elog("HINT: add \"Xeneon Edge\" to System Settings ▸ Privacy & Security ▸ Input Monitoring with the + button, enable it, then restart. If iCUE holds the device, quit it first.")
}

// Report what actually matched — zero devices means Input Monitoring is missing
// or the VID/PID/usage filter is wrong (not a crash; we keep waiting for hotplug).
let matched = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>) ?? []
elog("matched \(matched.count) device(s):")
for d in matched { elog("  " + deviceInfo(d)) }
if matched.isEmpty {
  elog("WARNING: no devices matched. If --list shows the panel but this is 0, Input Monitoring is almost certainly not granted yet.")
}

// Exit cleanly when the parent (Electron) terminates us.
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

elog("running — waiting for touch input")
CFRunLoopRun()
