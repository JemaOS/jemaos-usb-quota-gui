// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Privileged ESP operations (mount + read/write the signed counter). These
// must run as root; they are executed either in-process (when already elevated)
// or through the elevated helper (bin/jemaos-quota-priv.js via pkexec/UAC).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const platform = require('../platform');
const quota = require('./quota');
const { loadKey } = require('./crypto');

const DEFAULT_KEY = path.join(__dirname, '..', '..', 'resources', 'jemaos-quota.key');

function resolveKey(keyFile) {
  return path.resolve(keyFile || process.env.JEMAOS_QUOTA_KEY || DEFAULT_KEY);
}

function scan() {
  return platform.listDevices();
}

function findDisk(device) {
  const wanted = String(device);
  return (
    platform.listDevices().find(d => d.id === wanted || d.path === wanted || d.name === wanted) ||
    null
  );
}

function withEsp({ device, identity }, fn) {
  const disk = findDisk(device);
  if (!disk) {
    throw new Error(`Device not found: ${device}`);
  }
  if (!disk.removable || disk.systemDisk) {
    throw new Error('Select an external USB key, not an internal or system disk.');
  }
  if (identity !== undefined && identity !== disk.identity) {
    throw new Error('The selected device changed. Refresh the device list before continuing.');
  }
  if (disk.partitions.filter(p => p.esp).length > 1) {
    throw new Error('Several EFI partitions found. The target is ambiguous; no changes were made.');
  }
  const esp = platform.espPartition(disk);
  if (!esp) {
    throw new Error(`No EFI System Partition found on ${device}`);
  }
  const handle = platform.mountEsp(esp);
  let operationError;
  try {
    return fn(handle.mountDir, esp);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      platform.unmountEsp(handle);
    } catch (error) {
      if (operationError) operationError.message += ` (cleanup: ${error.message})`;
      else throw error;
    }
  }
}

function show({ device, identity, keyFile } = {}) {
  return withEsp({ device, identity }, (mountDir, esp) => {
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

function init({ device, identity, limit, keyFile } = {}) {
  const n = Number(limit);
  if (!(typeof limit === 'number' || typeof limit === 'string' && /^\d+$/.test(limit)) || !Number.isSafeInteger(n) || n < 0) {
    throw new Error('limit must be a non-negative integer');
  }
  return withEsp({ device, identity }, (mountDir, esp) => {
    const key = loadKey(resolveKey(keyFile));
    const file = quota.quotaPath(mountDir);
    quota.writeAtomic(file, quota.render(n, 0, key));
    const verified = quota.verify(fs.readFileSync(file, 'utf8'), key);
    if (!verified) {
      throw new Error('Post-write verification failed');
    }
    return { esp: esp.id, limit: verified.limit, used: verified.used, valid: true };
  });
}

module.exports = { scan, show, init, resolveKey, DEFAULT_KEY };
