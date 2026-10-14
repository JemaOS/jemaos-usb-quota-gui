// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Orchestration: scan devices, and init/show the signed quota.
//
// When the process is NOT elevated, the privileged ESP operation is delegated
// to the elevated helper (bin/jemaos-quota-priv.js) via the platform elevator
// (pkexec on Linux/macOS, UAC relaunch on Windows) so the whole app does not
// need to run as root.
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const platform = require('../platform');
const ops = require('./esp-ops');

const PRIV_HELPER = path.join(__dirname, '..', '..', 'bin', 'jemaos-quota-priv.js');

function scan() {
  return platform.listDevices();
}

function elevator() {
  if (process.platform === 'win32') {
    return null; // handled by electron-builder manifest / manual elevation
  }
  return 'pkexec';
}

function runPrivileged(action, params) {
  if (platform.isElevated()) {
    return ops[action](params);
  }
  const tool = elevator();
  if (!tool) {
    throw new Error('Administrator privileges required. Restart the app as administrator.');
  }
  try {
    const out = execFileSync(tool, [process.execPath, PRIV_HELPER, action, JSON.stringify(params)], {
      encoding: 'utf8',
    });
    return JSON.parse(out);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Élévation indisponible (${tool} absent). Relance l’application en administrateur : sudo node server.js`
      );
    }
    throw new Error(String((error.stderr || error.message || '').trim()));
  }
}

function show(params = {}) {
  return runPrivileged('show', params);
}

function init(params = {}) {
  return runPrivileged('init', params);
}

module.exports = { scan, show, init, resolveKey: ops.resolveKey };
