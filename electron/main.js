// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Electron wrapper: start the local server and open the GUI in a native window.
// The app must run with elevated privileges (root/admin) to mount & write the
// USB ESP. See README for per-OS instructions.
'use strict';

const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const URL = 'http://127.0.0.1:8770/';
let serverProc = null;

function startServer() {
  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    stdio: 'inherit',
    env: process.env,
  });
}

function waitForServer(url, tries = 50) {
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
          setTimeout(() => attempt(n - 1), 120);
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
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(URL);
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer(URL);
  } catch {
    /* still try to load; the window will show the error */
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProc) {
    serverProc.kill();
  }
  app.quit();
});
