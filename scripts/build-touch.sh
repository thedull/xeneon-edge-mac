#!/usr/bin/env bash
# Build the native Xeneon Edge touch helper and stage it in sidecars/ where both
# the dev runtime (src/touch.cjs) and electron-builder (extraResources) pick it up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/native/xeneon-touch"
OUT="$ROOT/sidecars/xeneon-touch"

if ! command -v swift >/dev/null 2>&1; then
  echo "error: swift toolchain not found (install Xcode Command Line Tools)." >&2
  exit 1
fi

echo "Building xeneon-touch (release)…"
( cd "$PKG" && swift build -c release )

BIN="$PKG/.build/release/xeneon-touch"
mkdir -p "$ROOT/sidecars"
cp -f "$BIN" "$OUT"

# `cp` invalidates the linker's ad-hoc signature on Apple Silicon, so the copy is
# SIGKILLed at launch ("Code Signature Invalid"). Re-sign the staged binary.
codesign --force --sign - "$OUT"
echo "Staged → $OUT"
