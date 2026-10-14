// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Orchestration: scan devices, and init/show the signed quota on a key.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const platform = require('../platform');
const quota = require('./quota');
const { loadKey } = require('./crypto');

const DEFAULT_KEY = path.join(__dirname, '..', '..', 'resources', 'jemaos-quota.key');

function resolveKey(keyFile) {
  return keyFile || process.env.JEMAOS_QUOTA_KEY || DEFAULT_KEY;
}

function scan() {
  return platform.listDevices();
}

function findDisk(device) {
  const wanted = String(device);
  return (
    platform
      .listDevices()
      .find(d => d.id === wanted || d.path === wanted || d.name === wanted) || null
  );
}

function withEsp(device, fn) {
  const disk = findDisk(device);
  if (!disk) {
    throw new Error(`Device not found: ${device}`);
  }
  const esp = platform.espPartition(disk);
  if (!esp) {
    throw new Error(`No EFI System Partition found on ${device}`);
  }
  const handle = platform.mountEsp(esp);
  try {
    return fn(handle.mountDir, esp);
  } finally {
    platform.unmountEsp(handle);
  }
}

/** Read + verify the current quota (if any). */
function show({ device, keyFile } = {}) {
  return withEsp(device, (mountDir, esp) => {
    const file = quota.quotaPath(mountDir);
    if (!fs.existsSync(file)) {
      return { esp: esp.id, present: false, valid: false };
    }
    const content = fs.readFileSync(file, 'utf8');
    const key = loadKey(resolveKey(keyFile));
    const verified = quota.verify(content, key);
    const parsed = quota.parse(content) || {};
    return {
      esp: esp.id,
      present: true,
      valid: Boolean(verified),
      limit: verified ? verified.limit : parsed.limit ?? null,
      used: verified ? verified.used : parsed.used ?? null,
    };
  });
}

/** Write a fresh signed counter (used=0, limit=N) and verify it. */
function init({ device, limit, keyFile } = {}) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('limit must be a non-negative integer');
  }
  const key = loadKey(resolveKey(keyFile));
  return withEsp(device, (mountDir, esp) => {
    const file = quota.quotaPath(mountDir);
    quota.writeAtomic(file, quota.render(n, 0, key));
    const verified = quota.verify(fs.readFileSync(file, 'utf8'), key);
    if (!verified) {
      throw new Error('Post-write verification failed');
    }
    return { esp: esp.id, limit: verified.limit, used: verified.used, valid: true };
  });
}

module.exports = { scan, show, init, resolveKey };
