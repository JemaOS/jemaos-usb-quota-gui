#!/usr/bin/env bash
# Copyright (c) 2026 The JemaOS Authors. All rights reserved.
#
# Fetch and build the tools needed to create macOS DMG files on Linux:
#   - mkfs.hfsplus / fsck.hfsplus  (official Ubuntu hfsprogs package)
#   - hfsplus / dmg                (mozilla/libdmg-hfsplus, pinned commit)
#   - rcodesign                    (indygreg/apple-platform-rs, ad-hoc signing)
#
# Everything is written under the target directory (default: /tmp/kilo/dmgtools)
# and verified by SHA-256 where the upstream publishes one.
set -euo pipefail

TOOLS="${1:-/tmp/kilo/dmgtools}"
LIBDMG_COMMIT="e18579b391950589b9ed16ee630c54ce4319bb29"
HFSPROGS_URL="https://archive.ubuntu.com/ubuntu/pool/universe/h/hfsprogs/hfsprogs_540.1.linux3-5build3_amd64.deb"
HFSPROGS_SHA="21aab68916cdba913b8571f1d83285f958878d2378255ee87a225575b917b77f"
RCODESIGN_URL="https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz"
RCODESIGN_SHA="dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002"

mkdir -p "$TOOLS"
cd "$TOOLS"

if [ ! -x "$TOOLS/hfs/sbin/mkfs.hfsplus" ]; then
  curl -fsSL -o hfsprogs.deb "$HFSPROGS_URL"
  echo "$HFSPROGS_SHA  hfsprogs.deb" | sha256sum -c -
  rm -rf hfs && mkdir hfs && dpkg-deb -x hfsprogs.deb hfs
fi

if [ ! -x "$TOOLS/rcodesign/rcodesign" ]; then
  curl -fsSL -o rcodesign.tar.gz "$RCODESIGN_URL"
  echo "$RCODESIGN_SHA  rcodesign.tar.gz" | sha256sum -c -
  rm -rf rcodesign && mkdir rcodesign && tar -xzf rcodesign.tar.gz -C rcodesign --strip-components=1
fi

if [ ! -x "$TOOLS/libdmg-hfsplus/build/dmg/dmg" ]; then
  rm -rf libdmg-hfsplus
  git clone --quiet https://github.com/mozilla/libdmg-hfsplus.git libdmg-hfsplus
  git -C libdmg-hfsplus checkout --quiet "$LIBDMG_COMMIT"
  cmake -S libdmg-hfsplus -B libdmg-hfsplus/build -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build libdmg-hfsplus/build --parallel "$(nproc)" >/dev/null
fi

cat <<EOF
Tools ready in $TOOLS

export MKFS_HFSPLUS="$TOOLS/hfs/sbin/mkfs.hfsplus"
export FSCK_HFSPLUS="$TOOLS/hfs/sbin/fsck.hfsplus"
export HFSPLUS="$TOOLS/libdmg-hfsplus/build/hfs/hfsplus"
export DMGTOOL="$TOOLS/libdmg-hfsplus/build/dmg/dmg"
export RCODESIGN="$TOOLS/rcodesign/rcodesign"
export ENTITLEMENTS="$(cd "$(dirname "$0")/.." && pwd)/node_modules/app-builder-lib/templates/entitlements.mac.plist"
EOF
