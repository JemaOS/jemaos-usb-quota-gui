// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Native Electron app: no local HTTP server, no port — the renderer talks to
// the main process through IPC (preload bridge). The privileged ESP work still
// uses the per-operation OS elevator (pkexec / UAC / osascript).
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../src/core/service');
const platform = require('../src/platform');

// Linux compatibility: some systems lack a properly set-up setuid chrome-sandbox
// or disable unprivileged user namespaces, which makes Electron refuse to start.
// This is a local, trusted UI, so we disable the Chromium sandbox and GPU
// acceleration to launch reliably everywhere.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();

function registerIpc() {
  ipcMain.handle('meta', () => {
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
  ipcMain.handle('devices', () => service.scan());
  ipcMain.handle('show', (_event, payload) => service.show(payload || {}));
  ipcMain.handle('init', (_event, payload) => service.init(payload || {}));
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
}

app.whenReady().then(() => {
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
