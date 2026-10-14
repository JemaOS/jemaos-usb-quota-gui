// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Electron wrapper: run the local server IN-PROCESS (Electron bundles Node, so
// there is no separate `node` binary), then open the GUI in a native window.
'use strict';

const { app, BrowserWindow } = require('electron');
const http = require('node:http');

const { start, PORT } = require('../server');

let server = null;
const URL = `http://127.0.0.1:${PORT}/`;

function waitForServer(url, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (n <= 0) {
            reject(new Error('Server did not start'));
            return;
          }
          setTimeout(() => attempt(n - 1), 100);
        });
    };
    attempt(tries);
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(URL);
}

app.whenReady().then(async () => {
  server = start(PORT);
  try {
    await waitForServer(URL);
  } catch {
    /* window will show the error */
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  app.quit();
});
