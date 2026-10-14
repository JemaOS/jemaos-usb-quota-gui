// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// macOS platform backend (diskutil). NOTE: implemented from the documented
// diskutil/plutil behaviour; validate on a real Mac before shipping.
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function plistToJson(plistText) {
  const res = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: plistText,
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

function diskInfo(id) {
  try {
    return plistToJson(run('diskutil', ['info', '-plist', id]));
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
  if (!disk) {
    return null;
  }
  return disk.partitions.find(p => p.esp) || null;
}

function mountEsp(partition) {
  run('diskutil', ['mount', partition.path]);
  const info = diskInfo(partition.path.replace('/dev/', ''));
  const mountDir = info.MountPoint || '/Volumes/EFI';
  return { mountDir, owned: true, handle: { device: partition.path, mountDir } };
}

function unmountEsp(handle) {
  if (!handle || !handle.handle) {
    return;
  }
  try {
    run('diskutil', ['unmount', handle.handle.mountDir]);
  } catch {
    /* best effort */
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
