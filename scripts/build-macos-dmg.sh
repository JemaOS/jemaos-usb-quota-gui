#!/usr/bin/env bash
# Copyright (c) 2026 The JemaOS Authors. All rights reserved.
#
# Build a real macOS .dmg from Linux, without macOS or hdiutil.
#
#   scripts/build-macos-dmg.sh <app-bundle> <output.dmg>
#
# Required tools (see scripts/fetch-dmg-tools.sh):
#   MKFS_HFSPLUS   mkfs.hfsplus  (hfsprogs)
#   FSCK_HFSPLUS   fsck.hfsplus  (hfsprogs)
#   HFSPLUS        hfsplus       (libdmg-hfsplus)
#   DMGTOOL        dmg           (libdmg-hfsplus)
#   RCODESIGN      rcodesign     (apple-codesign)
#   ENTITLEMENTS   entitlements.mac.plist
#
# The bundle is signed ad-hoc (integrity, not a trusted identity) and wrapped in
# an HFS+ volume compressed to UDIF (bzip2), the standard macOS disk image.
set -euo pipefail

APP="${1:?usage: build-macos-dmg.sh <app-bundle> <output.dmg>}"
OUT="${2:?usage: build-macos-dmg.sh <app-bundle> <output.dmg>}"
MKFS="${MKFS_HFSPLUS:?set MKFS_HFSPLUS}"
FSCK="${FSCK_HFSPLUS:?set FSCK_HFSPLUS}"
HFSPLUS="${HFSPLUS:?set HFSPLUS}"
DMG="${DMGTOOL:?set DMGTOOL}"
RCODESIGN="${RCODESIGN:?set RCODESIGN}"
ENT="${ENTITLEMENTS:?set ENTITLEMENTS}"
VOLNAME="Quota JemaOS"

[ -d "$APP" ] || { echo "Not an app bundle: $APP" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"

WORK="$(mktemp -d /tmp/kilo/macos-dmg.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# 1) Ad-hoc sign: children first, then re-seal the parent. Clean environment and
#    an empty config avoid picking up any implicit signing identity.
sign() {
  env -i PATH=/usr/bin:/bin "$RCODESIGN" --config-file /dev/null "$@"
}
echo "→ Signing (ad-hoc): $APP"
sign sign --timestamp-url none "$APP"
for helper in "$APP"/Contents/Frameworks/*Helper*.app; do
  [ -d "$helper" ] || continue
  sign sign --shallow --timestamp-url none --code-signature-flags runtime \
    --entitlements-xml-file "$ENT" "$helper"
done
sign sign --shallow --timestamp-url none --code-signature-flags runtime \
  --entitlements-xml-file "$ENT" "$APP"

# 2) Stage volume contents: the app plus the usual Applications shortcut.
STAGE="$WORK/stage"
mkdir -p "$STAGE"
cp -a "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

# 3) HFS+ volume sized to the payload, then import the staging tree.
BYTES="$(du -sb "$APP" | cut -f1)"
SIZE=$(( (BYTES + 67108864 + 1048575) / 1048576 * 1048576 ))
RAW="$WORK/volume.raw"
truncate -s "$SIZE" "$RAW"
"$MKFS" -v "$VOLNAME" -b 4096 "$RAW" >/dev/null
"$HFSPLUS" --symlinks clone_link --special-modes no "$RAW" addall "$STAGE" / >/dev/null
echo "→ HFS+ volume: $("$FSCK" -f -n "$RAW" | tail -1)"

# 4) Convert to a compressed UDIF disk image and verify it round-trips.
"$DMG" build "$RAW" "$OUT" >/dev/null
"$DMG" extract "$OUT" "$WORK/roundtrip.raw" >/dev/null
[ -s "$WORK/roundtrip.raw" ] || { echo "DMG extraction produced an empty image" >&2; exit 1; }
"$FSCK" -f -n "$WORK/roundtrip.raw" | grep -q "appears to be OK" \
  || { echo "DMG round-trip failed integrity check" >&2; exit 1; }
echo "→ DMG verified: $("$FSCK" -f -n "$WORK/roundtrip.raw" | tail -1)"
echo "→ $OUT ($(du -h "$OUT" | cut -f1))"
