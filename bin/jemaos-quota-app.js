#!/usr/bin/env node
// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Universal launcher: starts the local server and opens the default browser.
// Works identically on Linux / macOS / Windows. No elevation needed at start:
// privileged operations prompt per action (pkexec / UAC / osascript).
//
//   node bin/jemaos-quota-app.js   (or: npm start)
'use strict';

const { execFileSync } = require('node:child_process');
const { start, PORT } = require('../server');

const URL = `http://127.0.0.1:${PORT}/`;

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      execFileSync('open', [url], { stdio: 'ignore' });
    } else {
      execFileSync('xdg-open', [url], { stdio: 'ignore' });
    }
  } catch {
    console.log(`Open your browser at ${url}`);
  }
}

const server = start(PORT);
server.on('listening', () => openBrowser(URL));
