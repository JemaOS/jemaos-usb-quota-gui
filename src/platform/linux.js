// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Linux platform backend: enumerate block devices, locate the EFI System
// Partition (GUID c12a7328-…), mount it read-write and unmount it.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EFI_GUID = 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b';

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function isElevated() {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

/** @returns {Array} removable-friendly list of disks with their partitions */
function listDevices() {
  const out = run('lsblk', [
    '-J', '-b',
    '-o', 'NAME,PATH,TYPE,SIZE,MODEL,RM,TRAN,PARTTYPE,MOUNTPOINT',
  ]);
  const data = JSON.parse(out);
  const disks = (data.blockdevices || []).filter(d => d.type === 'disk');
  return disks.map(d => ({
    id: d.path,
    path: d.path,
    name: d.name,
    size: Number(d.size) || 0,
    model: String(d.model || '').trim(),
    removable: d.rm === true || d.rm === '1' || d.rm === 1,
    transport: String(d.tran || '').toUpperCase(),
    partitions: (d.children || []).map(c => ({
      id: c.path,
      path: c.path,
      name: c.name,
      size: Number(c.size) || 0,
      partType: String(c.parttype || '').toLowerCase(),
      mountpoint: c.mountpoint || null,
      esp: String(c.parttype || '').toLowerCase() === EFI_GUID,
    })),
  }));
}

function espPartition(disk) {
  if (!disk) {
    return null;
  }
  return disk.partitions.find(p => p.esp) || null;
}

/** Mount the ESP read-write. Returns { mountDir, owned }. */
function mountEsp(partition) {
  if (partition.mountpoint) {
    try {
      run('mount', ['-o', 'remount,rw', partition.mountpoint]);
    } catch {
      /* remount may be refused if not needed; continue */
    }
    return { mountDir: partition.mountpoint, owned: false };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jemaos-esp-'));
  run('mount', ['-o', 'rw', partition.path, dir]);
  return { mountDir: dir, owned: true };
}

function unmountEsp(handle) {
  if (!handle || !handle.owned) {
    return;
  }
  try {
    run('umount', [handle.mountDir]);
  } catch {
    /* best effort */
  }
  try {
    fs.rmdirSync(handle.mountDir);
  } catch {
    /* best effort */
  }
}

module.exports = {
  platform: 'linux',
  needsElevation: true,
  isElevated,
  listDevices,
  espPartition,
  mountEsp,
  unmountEsp,
};
