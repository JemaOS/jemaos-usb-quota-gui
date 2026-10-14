// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Windows platform backend (PowerShell / Storage cmdlets).
//
// The Windows ESP is normally NOT mounted and has no drive letter. We assign a
// temporary access path (drive letter), trying several documented strategies,
// then verify the volume is writable before writing the counter.
// Validate on Windows 10/11 before shipping.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EFI_GUID = '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}';

function ps(script) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: 30000 }
  );
}

function psJson(script) {
  const out = ps(script).trim();
  return out ? JSON.parse(out) : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function tryPs(script) {
  try {
    ps(script);
    return true;
  } catch {
    return false;
  }
}

function isElevated() {
  try {
    return (
      ps(
        '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
      )
        .trim()
        .toLowerCase() === 'true'
    );
  } catch {
    return false;
  }
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

function listDevices() {
  const disks = asArray(
    psJson('Get-Disk | Select-Object Number,FriendlyName,Size,BusType | ConvertTo-Json -Compress')
  );
  const parts = asArray(
    psJson(
      'Get-Partition | Select-Object DiskNumber,PartitionNumber,Size,GptType,DriveLetter,Type | ConvertTo-Json -Compress'
    )
  );

  return disks.map(d => ({
    id: String(d.Number),
    path: String(d.Number),
    name: `PhysicalDrive${d.Number}`,
    size: Number(d.Size) || 0,
    model: String(d.FriendlyName || '').trim(),
    removable: String(d.BusType || '').toUpperCase() === 'USB',
    transport: String(d.BusType || '').toUpperCase(),
    partitions: parts
      .filter(p => p.DiskNumber === d.Number)
      .map(p => ({
        id: `${p.DiskNumber}:${p.PartitionNumber}`,
        diskNumber: p.DiskNumber,
        partitionNumber: p.PartitionNumber,
        name: `Partition ${p.PartitionNumber}`,
        size: Number(p.Size) || 0,
        partType: String(p.GptType || '').toLowerCase(),
        driveLetter: p.DriveLetter || null,
        mountpoint: p.DriveLetter ? `${p.DriveLetter}:\\` : null,
        esp:
          String(p.GptType || '').toLowerCase() === EFI_GUID ||
          String(p.Type || '').toLowerCase() === 'system',
      })),
  }));
}

function espPartition(disk) {
  return disk ? disk.partitions.find(p => p.esp) || null : null;
}

function usedLetters() {
  return asArray(psJson('Get-Partition | Select-Object DriveLetter | ConvertTo-Json -Compress'))
    .map(p => p.DriveLetter)
    .filter(Boolean);
}

function freeDriveLetter() {
  const used = usedLetters();
  for (let c = 'Z'.charCodeAt(0); c >= 'D'.charCodeAt(0); c--) {
    const letter = String.fromCharCode(c);
    if (!used.includes(letter)) {
      return letter;
    }
  }
  throw new Error('No free drive letter available');
}

function volumePath(diskNumber, partitionNumber) {
  const paths = asArray(
    psJson(
      `(Get-Partition -DiskNumber ${diskNumber} -PartitionNumber ${partitionNumber}).AccessPaths | ConvertTo-Json -Compress`
    )
  );
  const flat = paths.flat ? paths.flat() : paths;
  return flat.find(p => typeof p === 'string' && /Volume\{/i.test(p)) || null;
}

function mountEsp(partition) {
  const d = partition.diskNumber;
  const p = partition.partitionNumber;

  if (partition.driveLetter && isWritable(`${partition.driveLetter}:\\`)) {
    return {
      mountDir: `${partition.driveLetter}:\\`,
      owned: false,
      handle: { diskNumber: d, partitionNumber: p, letter: partition.driveLetter },
    };
  }

  const letter = partition.driveLetter || freeDriveLetter();
  const accessPath = `${letter}:\\`;

  // Strategy A: assign a drive letter.
  tryPs(`Set-Partition -DiskNumber ${d} -PartitionNumber ${p} -NewDriveLetter ${letter}`);
  let ok = isWritable(accessPath);

  // Strategy B: add a partition access path.
  if (!ok) {
    tryPs(`Add-PartitionAccessPath -DiskNumber ${d} -PartitionNumber ${p} -AccessPath ${accessPath}`);
    ok = isWritable(accessPath);
  }

  // Strategy C: mount the volume with mountvol.
  if (!ok) {
    const vol = volumePath(d, p);
    if (vol) {
      tryPs(`mountvol ${letter}: ${vol.replace(/\\+$/, '\\')}`);
      ok = isWritable(accessPath);
    }
  }

  if (!ok) {
    throw new Error(
      `Could not mount the EFI partition (disk ${d} partition ${p}) for writing. ` +
        'Run the app as administrator and retry.'
    );
  }
  return { mountDir: accessPath, owned: !partition.driveLetter, handle: { diskNumber: d, partitionNumber: p, letter } };
}

function unmountEsp(handle) {
  if (!handle || !handle.owned || !handle.handle) {
    return;
  }
  const { diskNumber, partitionNumber, letter } = handle.handle;
  const accessPath = `${letter}:\\`;
  if (
    !tryPs(
      `Remove-PartitionAccessPath -DiskNumber ${diskNumber} -PartitionNumber ${partitionNumber} -AccessPath ${accessPath}`
    )
  ) {
    tryPs(`mountvol ${letter}: /D`);
  }
}

module.exports = {
  platform: 'win32',
  needsElevation: true,
  isElevated,
  listDevices,
  espPartition,
  mountEsp,
  unmountEsp,
};
