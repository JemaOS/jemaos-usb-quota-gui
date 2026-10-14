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
  switch (process.platform) {
    case 'linux':
      execFileSync('pkexec', [process.execPath, HELPER, ...helperArgs], { encoding: 'utf8' });
      break;
    case 'darwin': {
      const cmd = [process.execPath, HELPER, ...helperArgs].map(shquote).join(' ');
      const script = `do shell script "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`;
      execFileSync('osascript', ['-e', script], { encoding: 'utf8' });
      break;
    }
    case 'win32': {
      const cmd =
        `Start-Process -Verb RunAs -Wait -WindowStyle Hidden ` +
        `-FilePath ${psquote(process.execPath)} ` +
        `-ArgumentList ${helperArgs.map(psquote).join(',')}`;
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
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
