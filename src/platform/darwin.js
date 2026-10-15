// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// macOS platform backend (diskutil), with fallbacks and write verification.
// Validate on a real Mac before shipping.
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

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
  const res = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: text,
    encoding: 'utf8',
    timeout: 20000,
  });
  if (res.error) throw res.error;
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
    const probe = path.join(dir, `.jemaos-quota.${randomUUID()}.tmp`);
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// macOS mounts the EFI System Partition read-only by default. Remount it
// read-write in place (`mount -u -w`, which needs root) before giving up.
// Returns whether the mount point ends up writable.
function makeWritable(mountDir) {
  if (isWritable(mountDir)) {
    return true;
  }
  tryRun('/sbin/mount', ['-u', '-w', mountDir]);
  if (isWritable(mountDir)) {
    return true;
  }
  // Some builds expose the device only by identifier; remount it explicitly.
  let device = null;
  try {
    const info = diskInfo(mountDir);
    device = info.DeviceIdentifier ? `/dev/${info.DeviceIdentifier}` : null;
  } catch {
    device = null;
  }
  if (device) {
    tryRun('/sbin/mount', ['-u', '-w', device]);
  }
  return isWritable(mountDir);
}

function diskInfo(id) {
  return plistToJson(run('/usr/sbin/diskutil', ['info', '-plist', id]));
}

function listDevices() {
  const list = plistToJson(run('/usr/sbin/diskutil', ['list', '-plist']));
  const disks = list.AllDisksAndPartitions || [];
  const root = diskInfo('/');
  const bootDisks = new Set([root.ParentWholeDisk]);
  if (String(root.FilesystemType || root.FileSystemPersonality || '').toLowerCase().includes('apfs')) {
    const apfs = plistToJson(run('/usr/sbin/diskutil', ['apfs', 'list', '-plist']));
    for (const container of apfs.Containers || []) {
      if (container.ContainerReference === root.ParentWholeDisk || container.ContainerReference === root.APFSContainerReference) {
        for (const store of container.PhysicalStores || []) {
          bootDisks.add(String(store.DeviceIdentifier).replace(/s\d+.*$/, ''));
        }
      }
    }
  }
  return disks.filter(d => /^disk\d+$/.test(d.DeviceIdentifier)).map(d => {
    const info = diskInfo(d.DeviceIdentifier);
    const physical = info.VirtualOrPhysical === 'Physical';
    return {
      id: `/dev/${d.DeviceIdentifier}`,
      path: `/dev/${d.DeviceIdentifier}`,
      name: d.DeviceIdentifier,
      size: Number(d.Size) || Number(info.TotalSize) || 0,
      model: String(info.MediaName || '').trim(),
      removable: info.Internal === false && physical,
      transport: String(info.BusProtocol || '').toUpperCase(),
      systemDisk: Boolean(info.Internal || bootDisks.has(d.DeviceIdentifier)),
      identity: JSON.stringify([d.DeviceIdentifier, info.MediaUUID || info.DiskUUID || info.SerialNumber || '', Number(d.Size),
        (d.Partitions || []).filter(p => p.Content === 'EFI').map(p => [p.DeviceIdentifier, p.Size, p.VolumeUUID || ''])]),
      partitions: (d.Partitions || []).map(p => ({
        id: `/dev/${p.DeviceIdentifier}`,
        path: `/dev/${p.DeviceIdentifier}`,
        name: p.VolumeName || p.DeviceIdentifier,
        size: Number(p.Size) || 0,
        partType: String(p.Content || '').toLowerCase(),
        mountpoint: p.MountPoint || null,
        esp: String(p.Content || '').toUpperCase() === 'EFI',
        diskId: d.DeviceIdentifier,
        uuid: p.VolumeUUID || '',
      })),
    };
  });
}

function espPartition(disk) {
  const parts = disk ? disk.partitions.filter(p => p.esp) : [];
  return parts.length === 1 ? parts[0] : null;
}

function assertPartition(partition, info) {
  if (!/^\/dev\/disk\d+s\d+$/.test(partition.path)
      || info.DeviceIdentifier !== partition.path.slice(5)
      || info.ParentWholeDisk !== partition.diskId
      || String(info.Content || '').toUpperCase() !== 'EFI'
      || partition.uuid && info.VolumeUUID !== partition.uuid) {
    throw new Error('The selected EFI partition changed; no changes were made.');
  }
}

function assertMount(partition, mountDir) {
  assertPartition(partition, diskInfo(mountDir));
}

function mountEsp(partition, options = {}) {
  const writable = options.writable !== false;
  const shortId = partition.path.replace('/dev/', '');
  const before = diskInfo(shortId);
  assertPartition(partition, before);
  if (before.MountPoint) {
    assertMount(partition, before.MountPoint);
    // Reading does not need write access; only force rw before a write.
    if (writable && !makeWritable(before.MountPoint)) {
      throw new Error('The EFI partition is read-only.');
    }
    return { mountDir: before.MountPoint, owned: false };
  }

  const handle = { owned: false, mountDir: null, handle: { partition, createdDir: null } };
  try {
    const attempt = tryRun('/usr/sbin/diskutil', ['mount', partition.path]);
    handle.owned = attempt.ok;
    const after = diskInfo(shortId);
    assertPartition(partition, after);
    handle.mountDir = after.MountPoint;
    if (!handle.mountDir) {
      if (attempt.ok) throw new Error('diskutil reported a mount without a usable mount point.');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jemaos-esp-'));
      handle.handle.createdDir = dir;
      run('/sbin/mount', ['-t', 'msdos', partition.path, dir]);
      handle.owned = true;
      handle.mountDir = dir;
    }
    assertMount(partition, handle.mountDir);
    if (writable && !makeWritable(handle.mountDir)) {
      throw new Error('The EFI partition is read-only.');
    }
    return handle;
  } catch (error) {
    try { unmountEsp(handle); }
    catch (cleanup) { error.message += ` (cleanup: ${cleanup.message})`; }
    throw error;
  }
}

function unmountEsp(handle) {
  if (!handle || !handle.handle) {
    return;
  }
  const { partition, createdDir } = handle.handle;
  if (handle.owned) {
    const before = diskInfo(partition.path);
    assertPartition(partition, before);
    if (before.MountPoint) {
      if (handle.mountDir && path.resolve(before.MountPoint) !== path.resolve(handle.mountDir)) {
        throw new Error('Mount changed; refusing to unmount another session.');
      }
      const res = tryRun('/usr/sbin/diskutil', ['unmount', partition.path]);
      if (!res.ok) run('/sbin/umount', [before.MountPoint]);
      if (diskInfo(partition.path).MountPoint) throw new Error('Could not unmount the temporary EFI volume.');
    }
  }
  if (createdDir) fs.rmdirSync(createdDir);
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
