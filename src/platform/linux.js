// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Linux platform backend: enumerate block devices, locate the EFI System
// Partition (GUID c12a7328-…), mount it read-write (with fallbacks) and verify
// it is actually writable before use.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const EFI_GUID = 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b';

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 20000 });
}
function tryRun(cmd, args) {
  try {
    return { ok: true, out: run(cmd, args) };
  } catch (error) {
    return { ok: false, error };
  }
}

function isElevated() {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function isWritable(dir) {
  try {
    const probe = path.join(dir, `.jemaos-quota.${randomUUID()}.tmp`);
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function isSystemDisk(block) {
  return ['/', '/boot', '/boot/efi'].includes(block.mountpoint)
    || (block.children || []).some(isSystemDisk);
}

function listDevices() {
  const out = run('lsblk', [
    '-J', '-b', '-o', 'NAME,PATH,TYPE,SIZE,MODEL,SERIAL,WWN,RM,TRAN,PARTTYPE,PARTUUID,MOUNTPOINT',
  ]);
  const data = JSON.parse(out);
  const disks = (data.blockdevices || []).filter(d => d.type === 'disk');
  return disks.map(d => ({
    id: d.path,
    path: d.path,
    name: d.name,
    size: Number(d.size) || 0,
    model: String(d.model || '').trim(),
    removable: d.tran === 'usb' || d.rm === true || d.rm === '1' || d.rm === 1,
    transport: String(d.tran || '').toUpperCase(),
    identity: JSON.stringify([d.path, d.wwn || d.serial || '', Number(d.size),
      (d.children || []).filter(p => p.parttype === EFI_GUID).map(p => p.partuuid || p.path)]),
    systemDisk: isSystemDisk(d),
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
  return disk ? disk.partitions.find(p => p.esp) || null : null;
}

function mountEsp(partition) {
  // 1) Already mounted: try to make it writable in place.
  if (partition.mountpoint) {
    tryRun('mount', ['-o', 'remount,rw', partition.mountpoint]);
    if (isWritable(partition.mountpoint)) {
      return { mountDir: partition.mountpoint, owned: false };
    }
  }
  // 2) Mount somewhere private.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jemaos-esp-'));
  const first = tryRun('mount', ['-o', 'rw', partition.path, dir]);
  if (!first.ok) {
    const second = tryRun('mount', [partition.path, dir]);
    if (!second.ok) {
      fs.rmdirSync(dir);
      throw new Error(`Mount failed for ${partition.path}: ${(second.error || first.error).message}`);
    }
    tryRun('mount', ['-o', 'remount,rw', dir]);
  }
  if (!isWritable(dir)) {
    const cleanup = tryRun('umount', [dir]);
    if (cleanup.ok) fs.rmdirSync(dir);
    throw new Error(`ESP ${partition.path} mounted but not writable`);
  }
  return { mountDir: dir, owned: true };
}

function unmountEsp(handle) {
  if (!handle || !handle.owned) {
    return;
  }
  const result = tryRun('umount', [handle.mountDir]);
  if (!result.ok) throw new Error(`Could not unmount the EFI partition: ${handle.mountDir}`);
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
