// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Orchestration + elevation. The privileged ESP operation runs inline when the
// process is already elevated, otherwise it is delegated to the elevated helper
// (bin/jemaos-quota-priv.js) using the OS-native elevator:
//   - Linux  : pkexec
//   - macOS  : osascript "with administrator privileges"
//   - Windows: PowerShell Start-Process -Verb RunAs
// Results are exchanged through a temporary file (robust with any elevator).
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const platform = require('../platform');
const ops = require('./esp-ops');

const HELPER = path.join(__dirname, '..', '..', 'bin', 'jemaos-quota-priv.js');

function scan() {
  return platform.listDevices();
}

function shquote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function psquote(value) {
  return `'${String(value).replace(/'/g, `''`)}'`;
}

function runElevated(action, paramsFile, outFile) {
  const helperArgs = [action, paramsFile, outFile];
  // Inside Electron there is no separate `node` binary: the elevated helper
  // must run through the Electron binary in Node mode.
  const isElectron = Boolean(process.versions.electron);
  switch (process.platform) {
    case 'linux': {
      const args = isElectron
        ? ['env', 'ELECTRON_RUN_AS_NODE=1', process.execPath, HELPER, ...helperArgs]
        : [process.execPath, HELPER, ...helperArgs];
      execFileSync('pkexec', args, { encoding: 'utf8' });
      break;
    }
    case 'darwin': {
      const parts = isElectron
        ? ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', process.execPath, HELPER, ...helperArgs]
        : [process.execPath, HELPER, ...helperArgs];
      const cmd = parts.map(shquote).join(' ');
      const script = `do shell script "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`;
      execFileSync('osascript', ['-e', script], { encoding: 'utf8' });
      break;
    }
    case 'win32': {
      const inner = isElectron
        ? `set ELECTRON_RUN_AS_NODE=1&& "${process.execPath}" ${helperArgs.map(a => `"${a}"`).join(' ')}`
        : `"${process.execPath}" ${helperArgs.map(a => `"${a}"`).join(' ')}`;
      const realCmd =
        `Start-Process -Verb RunAs -Wait -WindowStyle Hidden -FilePath 'cmd.exe' ` +
        `-ArgumentList '/c', ${psquote(inner)}`;
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', realCmd], {
        encoding: 'utf8',
      });
      break;
    }
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function runPrivileged(action, params) {
  if (platform.isElevated()) {
    return ops[action](params);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jemaos-quota-'));
  const paramsFile = path.join(dir, 'params.json');
  const outFile = path.join(dir, 'out.json');
  fs.writeFileSync(paramsFile, JSON.stringify(params));
  try {
    runElevated(action, paramsFile, outFile);
    if (!fs.existsSync(outFile)) {
      throw new Error('Elevated operation did not return a result (authorization cancelled?)');
    }
    const result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    if (result && result.error) {
      throw new Error(result.error);
    }
    return result;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'Elevation unavailable (pkexec/osascript/powershell missing). Run the app as administrator.'
      );
    }
    throw error;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function show(params = {}) {
  return runPrivileged('show', params);
}

function init(params = {}) {
  return runPrivileged('init', params);
}

module.exports = { scan, show, init, resolveKey: ops.resolveKey };
