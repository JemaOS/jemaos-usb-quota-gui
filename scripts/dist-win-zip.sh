#!/usr/bin/env bash
# Copyright (c) 2026 The JemaOS Authors. All rights reserved.
#
# Build a portable Windows .zip of the full application folder (all DLLs
# included). Useful when the self-extracting portable .exe is blocked by
# antivirus or fails with "ffmpeg.dll not found".
set -euo pipefail
cd "$(dirname "$0")/.."
icon_args=()
npx electron-builder --win zip --x64 --publish never \
  --config.win.signAndEditExecutable=false \
  --config.win.artifactName='Quota-JemaOS-${version}-windows-${arch}.zip' "${icon_args[@]}"
