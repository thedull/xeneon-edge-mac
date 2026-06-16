#!/usr/bin/env bash
# Build the packaged "Xeneon Edge.app" (with the native touch helper inside),
# ad-hoc code-sign it so it has a STABLE identity that macOS TCC can track
# (Input Monitoring / Accessibility grants stick to it), and launch it.
#
#   npm run app          # build + sign + launch
#   npm run app -- --no-open   # build + sign only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
APP="dist/mac-arm64/Xeneon Edge.app"
OPEN=1
[[ "${1:-}" == "--no-open" ]] && OPEN=0

echo "▶ Building native touch helper…"
bash scripts/build-touch.sh

echo "▶ Stopping any running instance…"
osascript -e 'quit app "Xeneon Edge"' 2>/dev/null || true
pkill -f "Xeneon Edge.app/Contents/MacOS" 2>/dev/null || true
pkill -f "Resources/xeneon-touch" 2>/dev/null || true

echo "▶ Packaging app (electron-builder --dir, unsigned)…"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir >/dev/null

# Prefer the stable self-signed dev cert (see scripts/dev-cert.sh) so TCC grants
# (Input Monitoring / Accessibility) survive rebuilds. Fall back to ad-hoc.
SIGN_ID="Xeneon Edge Dev"
if ! security find-certificate -c "$SIGN_ID" >/dev/null 2>&1; then
  echo "  (dev cert '$SIGN_ID' not found — falling back to ad-hoc; grants will reset each build)"
  SIGN_ID="-"
fi
echo "▶ Signing with: $SIGN_ID (helper, then app bundle)…"
codesign --force --sign "$SIGN_ID" --identifier com.gabrieltrujillo.xeneon-touch "$APP/Contents/Resources/xeneon-touch"
codesign --force --deep --sign "$SIGN_ID" "$APP"

echo "▶ Installing to /Applications…"
rm -rf "/Applications/Xeneon Edge.app"
cp -R "$APP" "/Applications/Xeneon Edge.app"
echo "✓ Installed: /Applications/Xeneon Edge.app"

if [[ "$OPEN" == "1" ]]; then
  echo "▶ Launching…"
  open "/Applications/Xeneon Edge.app"
fi

cat <<'EOF'

──────────────────────────────────────────────────────────────────────────────
First run needs two one-time permission grants for "Xeneon Edge" in
System Settings ▸ Privacy & Security:
  • Accessibility    (usually auto-prompts)
  • Input Monitoring (NO auto-prompt for a touchscreen — add it with the +
                      button, pick this app, enable it)
Then relaunch:  npm run app
Helper log:     tail -f ~/Library/Logs/xeneon-touch.log
──────────────────────────────────────────────────────────────────────────────
EOF
