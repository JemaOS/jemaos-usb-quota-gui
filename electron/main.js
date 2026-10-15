// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Native Electron app: the renderer talks to the main process through IPC
// (preload bridge). On Windows the app self-elevates once at launch so device
// operations run directly; on Linux/macOS the privilege is delegated per
// operation (pkexec / osascript).
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const service = require('../src/core/service');
const platform = require('../src/platform');
const smokeTest = process.argv.includes('--smoke-test');
const uiFile = path.join(__dirname, '..', 'ui', 'index.html');
const uiUrl = pathToFileURL(uiFile).href;
let mainWindow;

function powershellPath() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// The build may be produced on Linux, where electron-builder cannot embed a
// requireAdministrator manifest into the exe. To guarantee that disk operations
// have the required rights, we elevate once at startup instead of per operation
// (the per-operation elevation was unreliable). Returns false when the user
// cancels the UAC prompt, in which case the app quits.
function ensureWindowsAdmin() {
  if (process.platform !== 'win32' || smokeTest || process.argv.includes('--elevated')) {
    return true;
  }
  const powershell = powershellPath();
  const isAdmin =
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())' +
    '.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';
  try {
    const out = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', isAdmin], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    if (out.trim().toLowerCase() === 'true') {
      return true;
    }
  } catch {
    /* fall through to the elevation attempt */
  }
  try {
    const exe = app.getPath('exe').replace(/'/g, "''");
    execFileSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command',
        `Start-Process -FilePath '${exe}' -ArgumentList '--elevated' -Verb RunAs`],
      { encoding: 'utf8', timeout: 15000, windowsHide: true }
    );
  } catch {
    /* the user dismissed the UAC prompt */
  }
  return false;
}

// Linux compatibility: some systems lack a properly set-up setuid chrome-sandbox
// or disable unprivileged user namespaces, which makes Electron refuse to start.
// Keep this existing compatibility fallback on Linux only. Windows/macOS
// retain the renderer sandbox and do not run the whole UI as administrator.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.disableHardwareAcceleration();
}

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents
      || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== uiUrl) {
    throw new Error('Unauthorized native request');
  }
}

function deviceRequest(payload, write = false) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || typeof payload.device !== 'string' || !payload.device || payload.device.length > 256
      || /[\x00-\x1f]/.test(payload.device)
      || payload.identity !== undefined && (typeof payload.identity !== 'string' || payload.identity.length > 4096)
      || Object.keys(payload).some(key => !['device', 'identity', ...(write ? ['limit'] : [])].includes(key))) {
    throw new Error('Invalid device request');
  }
  if (write && (!Number.isSafeInteger(payload.limit) || payload.limit < 0)) {
    throw new Error('Invalid installation limit');
  }
  return { device: payload.device, identity: payload.identity, ...(write ? { limit: payload.limit } : {}) };
}

function registerIpc() {
  ipcMain.handle('meta', event => {
    trusted(event);
    let keyPresent = false;
    try {
      keyPresent = fs.existsSync(service.resolveKey());
    } catch {
      keyPresent = false;
    }
    return {
      platform: platform.platform,
      elevated: platform.isElevated(),
      needsElevation: platform.needsElevation,
      keyPresent,
    };
  });
  // Launch validation must never mount or write to a real USB device.
  ipcMain.handle('devices', event => {
    trusted(event);
    return smokeTest ? [] : service.scan();
  });
  ipcMain.handle('show', (_event, payload) => {
    trusted(_event);
    if (smokeTest) throw new Error('USB operations disabled during launch validation');
    return service.show(deviceRequest(payload));
  });
  ipcMain.handle('init', (_event, payload) => {
    trusted(_event);
    if (smokeTest) throw new Error('USB operations disabled during launch validation');
    return service.init(deviceRequest(payload, true));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 840,
    height: 920,
    minWidth: 560,
    minHeight: 640,
    title: 'Quota JemaOS',
    backgroundColor: '#0f1012',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: !smokeTest,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: process.platform !== 'linux',
    },
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== uiUrl) event.preventDefault();
  });
  if (smokeTest) {
    win.webContents.once('did-fail-load', (_event, _code, description) => {
      console.error(description);
      app.exit(1);
    });
    win.webContents.once('did-finish-load', async () => {
      try {
        const result = await win.webContents.executeJavaScript(`(async () => {
          const meta = await window.jemaos.invoke('meta');
          const devices = await window.jemaos.invoke('devices');
          return { protocol: location.protocol, platform: meta.platform, devices: devices.length };
        })()`);
        if (result.protocol !== 'file:' || result.devices !== 0) {
          throw new Error('Native launch validation failed');
        }
        console.log(JSON.stringify({ native: true, ...result }));
        app.exit(0);
      } catch (error) {
        console.error(error.message);
        app.exit(1);
      }
    });
  }
  win.loadFile(uiFile);
}

app.whenReady().then(() => {
  if (!ensureWindowsAdmin()) {
    app.quit();
    return;
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
