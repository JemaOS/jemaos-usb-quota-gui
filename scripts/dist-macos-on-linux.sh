#!/usr/bin/env bash
# Copyright (c) 2026 The JemaOS Authors. All rights reserved.
#
# One-command macOS DMG build from Linux (no macOS, no hdiutil):
#   npm run dist:mac:linux
#
# It fetches the tools, produces the unsigned .app bundles with electron-builder,
# then signs them ad-hoc and wraps each into a compressed UDIF .dmg.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TOOLS="${DMG_TOOLS_DIR:-/tmp/kilo/dmgtools}"

bash scripts/fetch-dmg-tools.sh "$TOOLS" >/dev/null
export MKFS_HFSPLUS="$TOOLS/hfs/sbin/mkfs.hfsplus"
export FSCK_HFSPLUS="$TOOLS/hfs/sbin/fsck.hfsplus"
export HFSPLUS="$TOOLS/libdmg-hfsplus/build/hfs/hfsplus"
export DMGTOOL="$TOOLS/libdmg-hfsplus/build/dmg/dmg"
export RCODESIGN="$TOOLS/rcodesign/rcodesign"
export ENTITLEMENTS="$ROOT/node_modules/app-builder-lib/templates/entitlements.mac.plist"

VERSION="$(node -p "require('./package.json').version")"

if [ ! -d dist/mac/quota-jemaos.app ] || [ ! -d dist/mac-arm64/quota-jemaos.app ]; then
  echo "→ Building unsigned macOS bundles (x64 + arm64)"
  npm run dist:mac:dir
fi

for arch in x64 arm64; do
  dir=$([ "$arch" = x64 ] && echo mac || echo mac-arm64)
  scripts/build-macos-dmg.sh "dist/$dir/quota-jemaos.app" "dist/Quota-JemaOS-$VERSION-macos-$arch.dmg"
done

echo "Done:"
ls -lh dist/*.dmg