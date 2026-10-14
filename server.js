// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Local server (127.0.0.1) serving the GUI and the quota API. No dependencies.
// Export start() for launchers (bin/jemaos-quota-app.js, Electron).
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const service = require('./src/core/service');
const platform = require('./src/platform');
const { resolveKey } = require('./src/core/service');

const UI_DIR = path.join(__dirname, 'ui');
const PORT = Number(process.env.PORT || 8770);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/meta') {
    let keyPresent = false;
    try {
      keyPresent = fs.existsSync(resolveKey());
    } catch {
      keyPresent = false;
    }
    return sendJson(res, 200, {
      platform: platform.platform,
      elevated: platform.isElevated(),
      needsElevation: platform.needsElevation,
      keyPresent,
    });
  }
  if (req.method === 'GET' && pathname === '/api/devices') {
    return sendJson(res, 200, { devices: service.scan() });
  }
  if (req.method === 'POST' && pathname === '/api/show') {
    return sendJson(res, 200, service.show(await readBody(req)));
  }
  if (req.method === 'POST' && pathname === '/api/init') {
    return sendJson(res, 200, service.init(await readBody(req)));
  }
  return sendJson(res, 404, { error: 'Unknown endpoint' });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    try {
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
        return;
      }
      if (pathname === '/' || pathname === '/index.html') {
        return sendFile(res, path.join(UI_DIR, 'index.html'));
      }
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      const filePath = path.join(UI_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
      return sendFile(res, filePath);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
  });
}

function start(port = PORT) {
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(
      `JemaOS USB Quota — http://127.0.0.1:${port}  (${platform.platform}, elevated=${platform.isElevated()})`
    );
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createServer, start, PORT };
