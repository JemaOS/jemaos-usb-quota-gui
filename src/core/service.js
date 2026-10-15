// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Orchestration + elevation. The privileged ESP operation runs inline when the
// process is already elevated, otherwise it is delegated to the elevated helper
// (bin/jemaos-quota-priv.js) using the OS-native elevator:
//   - Linux  : pkexec
//   - macOS  : osascript "with administrator privileges"
//   - Windows: PowerShell Start-Process -Verb RunAs
// Results are exchanged through a temporary file (robust with any elevator).
'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const platform = require('../platform');
const ops = require('./esp-ops');
const { elevationCandidates } = require('./elevation');
const execute = promisify(execFile);

// Files listed in electron-builder's `asarUnpack` live next to the archive as
// real files under `app.asar.unpacked/`. The privileged helper must be a real
// path so it can be executed by pkexec/osascript.
function unpackedPath(p) {
  const marker = `app.asar${path.sep}`;
  return p.includes(marker) ? p.replace(marker, `app.asar.unpacked${path.sep}`) : p;
}

const HELPER = unpackedPath(path.join(__dirname, '..', '..', 'bin', 'jemaos-quota-priv.js'));

async function scan() {
  try {
    // Explicit scan (app start / refresh button) always reads fresh state.
    const devices = platform.listDevices(true);
    // On Linux, partition types come from the udev database; inside a container
    // (e.g. ChromeOS Linux container) it may be empty, so the ESP cannot be
    // found by its type GUID. If a removable disk exposes partitions but none of
    // their types could be resolved, retry the whole scan elevated, where
    // `blkid -p` can read the partition table directly.
    if (process.platform === 'linux' && !platform.isElevated()) {
      const needsElevation = devices.some(d => d.removable && !d.systemDisk
        && d.partitions.length > 0 && d.partitions.every(p => !p.partType));
      if (needsElevation) {
        return runPrivileged('scan', {});
      }
    }
    return devices;
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'ADMIN_REQUIRED') {
      return runPrivileged('scan', {});
    }
    throw error;
  }
}

async function runPrivileged(action, params) {
  if (!['scan', 'show', 'init'].includes(action) || !params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('Invalid privileged request');
  }
  if (platform.isElevated()) {
    return ops[action](params);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jemaos-quota-'));
  const paramsFile = path.join(dir, 'params.json');
  const outFile = path.join(dir, 'out.json');
  try {
    const request = action === 'scan' ? params : { ...params, keyFile: ops.resolveKey(params.keyFile) };
    fs.writeFileSync(paramsFile, JSON.stringify(request), { flag: 'wx', mode: 0o600 });
    const candidates = elevationCandidates({
      platform: process.platform,
      executable: process.execPath,
      helper: HELPER,
      action,
      paramsFile,
      outFile,
      electron: Boolean(process.versions.electron),
      systemRoot: process.env.SystemRoot,
    });
    let launchError;
    let launchDetail = '';
    for (const command of candidates) {
      if (fs.existsSync(outFile)) {
        break;
      }
      launchError = undefined;
      try {
        await execute(command.file, command.args, { encoding: 'utf8', windowsHide: true });
      } catch (error) {
        launchError = error;
        const detail = String(error.stderr || error.message || '').trim();
        if (detail) {
          launchDetail = detail.split('\n').slice(0, 3).join(' ');
        }
        // A missing elevation tool (ENOENT) is not fatal: try the next candidate.
        if (error.code !== 'ENOENT' && fs.existsSync(outFile)) {
          break;
        }
      }
    }
    if (!fs.existsSync(outFile)) {
      if (launchError && launchError.code === 'ENOENT') {
        throw new Error('Authorization tool unavailable. Run the application as administrator.');
      }
      const suffix = launchDetail ? ` (${launchDetail})` : '';
      throw new Error(launchError
        ? `Authorization cancelled or privileged helper could not start.${suffix}`
        : 'Privileged helper returned no result.');
    }
    let result;
    try {
      result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    } catch {
      throw new Error('Privileged helper returned an invalid result.');
    }
    if (result && typeof result.error === 'string') {
      throw new Error(result.error);
    }
    if (launchError) {
      throw new Error('Privileged helper reported a result but did not complete successfully.');
    }
    const valid = action === 'scan' ? Array.isArray(result)
      : result && !Array.isArray(result) && typeof result.valid === 'boolean'
        && (action !== 'show' || typeof result.present === 'boolean')
        && (action !== 'init' || result.valid === true && Number.isSafeInteger(result.limit) && result.used === 0);
    if (!valid) throw new Error('Privileged helper returned an unexpected result.');
    return result;
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
