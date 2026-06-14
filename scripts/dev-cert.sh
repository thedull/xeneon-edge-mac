#!/usr/bin/env bash
# Create a stable self-signed code-signing certificate ("Xeneon Edge Dev") in the
# login keychain. Signing the app with a STABLE identity (instead of ad-hoc) means
# macOS TCC grants (Input Monitoring / Accessibility) survive rebuilds — grant
# once, then iterate freely. Idempotent.
#
# Notes:
#  • Uses /usr/bin/openssl and imports key + cert as separate PEMs; the PKCS12
#    path fails with "MAC verification failed" on OpenSSL 3 / modern macOS.
#  • The cert is untrusted, so `security find-identity -v` lists it as 0 valid —
#    that's fine: codesign still signs by name and TCC tracks the designated
#    requirement (stable identifier + cert hash).
set -euo pipefail

NAME="Xeneon Edge Dev"
KC="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  echo "✓ Code-signing cert '$NAME' already present."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 3650 \
  -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"
security import "$TMP/key.pem"  -k "$KC" -T /usr/bin/codesign -A
security import "$TMP/cert.pem" -k "$KC" -T /usr/bin/codesign -A
echo "✓ Created code-signing cert '$NAME' in login keychain."
