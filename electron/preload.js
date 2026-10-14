// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Preload: expose a minimal, safe bridge to the renderer (no Node in the page).
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jemaos', {
  // action: 'meta' | 'devices' | 'show' | 'init'
  invoke: (action, payload) => ipcRenderer.invoke(action, payload),
});
