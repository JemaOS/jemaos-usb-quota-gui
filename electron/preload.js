// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Preload: expose a minimal, safe bridge to the renderer (no Node in the page).
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const actions = new Set(['meta', 'devices', 'show', 'init']);
contextBridge.exposeInMainWorld('jemaos', {
  invoke: (action, payload) => actions.has(action)
    ? ipcRenderer.invoke(action, payload)
    : Promise.reject(new Error('Unsupported native action')),
});
