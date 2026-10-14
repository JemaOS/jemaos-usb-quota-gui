// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// macOS platform backend (diskutil), with fallbacks and write verification.
// Validate on a real Mac before shipping.
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

function plistToJson(text) {
  const res = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: text,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`plutil failed: ${res.stderr}`);
  }
  return JSON.parse(res.stdout);
}

function isElevated() {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function isWritable(dir) {
  try {
    const probe = path.join(dir, `.jemaos-quota.${process.pid}.tmp`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function diskInfo(id) {
  const res = tryRun('diskutil', ['info', '-plist', id]);
  if (!res.ok) {
    return {};
  }
  try {
    return plistToJson(res.out);
  } catch {
    return {};
  }
}

function listDevices() {
  const list = plistToJson(run('diskutil', ['list', '-plist']));
  const disks = list.AllDisksAndPartitions || [];
  return disks.map(d => {
    const info = diskInfo(d.DeviceIdentifier);
    return {
      id: `/dev/${d.DeviceIdentifier}`,
      path: `/dev/${d.DeviceIdentifier}`,
      name: d.DeviceIdentifier,
      size: Number(d.Size) || Number(info.TotalSize) || 0,
      model: String(info.MediaName || '').trim(),
      removable: info.RemovableMedia === true || info.Internal === false,
      transport: String(info.BusProtocol || '').toUpperCase(),
      partitions: (d.Partitions || []).map(p => ({
        id: `/dev/${p.DeviceIdentifier}`,
        path: `/dev/${p.DeviceIdentifier}`,
        name: p.VolumeName || p.DeviceIdentifier,
        size: Number(p.Size) || 0,
        partType: String(p.Content || '').toLowerCase(),
        mountpoint: p.MountPoint || null,
        esp: String(p.Content || '').toUpperCase() === 'EFI',
      })),
    };
  });
}

function espPartition(disk) {
  return disk ? disk.partitions.find(p => p.esp) || null : null;
}

function mountEsp(partition) {
  const shortId = partition.path.replace('/dev/', '');
  const before = diskInfo(shortId);
  if (before.MountPoint) {
    return { mountDir: before.MountPoint, owned: false };
  }

  tryRun('diskutil', ['mount', partition.path]);
  let info = diskInfo(shortId);
  let mountDir = info.MountPoint;

  if (!mountDir) {
    // Fallback: mount the FAT partition manually.
    mountDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jemaos-esp-'));
    const res = tryRun('mount', ['-t', 'msdos', partition.path, mountDir]);
    if (!res.ok) {
      throw new Error(`Could not mount ${partition.path}: ${res.error.message}`);
    }
  }
  if (!isWritable(mountDir)) {
    throw new Error(`ESP mounted but not writable: ${mountDir}`);
  }
  return { mountDir, owned: true, handle: { device: partition.path, mountDir } };
}

function unmountEsp(handle) {
  if (!handle || !handle.owned || !handle.handle) {
    return;
  }
  const res = tryRun('diskutil', ['unmount', handle.handle.mountDir]);
  if (!res.ok) {
    tryRun('umount', [handle.handle.mountDir]);
  }
}

module.exports = {
  platform: 'darwin',
  needsElevation: true,
  isElevated,
  listDevices,
  espPartition,
  mountEsp,
  unmountEsp,
};
