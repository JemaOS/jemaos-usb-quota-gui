// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Platform backend dispatcher (Linux / macOS / Windows).
'use strict';

function load() {
  switch (process.platform) {
    case 'linux':
      return require('./linux');
    case 'darwin':
      return require('./darwin');
    case 'win32':
      return require('./win32');
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

module.exports = load();
