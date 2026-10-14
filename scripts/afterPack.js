// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// electron-builder afterPack hook (Linux): replace the main executable with a
// tiny wrapper that always passes --no-sandbox. This makes the app start on
// systems where the Chromium SUID sandbox is not configured (chrome-sandbox not
// setuid / unprivileged user namespaces disabled) — for the .deb, the AppImage
// (AppRun) and the plain unpacked build alike.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }
  const appOutDir = context.appOutDir;
  const exeName = context.packager.executableName || 'quota-jemaos';
  const binPath = path.join(appOutDir, exeName);
  const realPath = path.join(appOutDir, `${exeName}-bin`);

  if (!fs.existsSync(binPath)) {
    return;
  }
  if (fs.existsSync(realPath)) {
    return; // already wrapped
  }

  fs.renameSync(binPath, realPath);
  fs.writeFileSync(
    binPath,
    `#!/bin/sh\nexec "$(dirname "$0")/${exeName}-bin" --no-sandbox "$@"\n`,
    { mode: 0o755 }
  );
  fs.chmodSync(binPath, 0o755);
};
