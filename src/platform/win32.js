// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Windows platform backend (PowerShell / Storage cmdlets).
//
// NOTE: the Windows ESP is normally NOT mounted and has no drive letter. We
// assign a temporary free drive letter (admin required), write the file, then
// remove the letter. Implemented from documented cmdlet behaviour; validate on
// Windows 10/11 before shipping.
'use strict';

const { execFileSync } = require('node:child_process');

const EFI_GUID = '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}';

function ps(script) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8' }
  );
}

function psJson(script) {
  const out = ps(script).trim();
  return out ? JSON.parse(out) : null;
}

function isElevated() {
  try {
    const out = ps(
      '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
    );
    return out.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

function listDevices() {
  const disks = psJson(
    'Get-Disk | Select-Object Number,FriendlyName,Size,BusType,IsBoot,IsSystem | ConvertTo-Json -Compress'
  );
  const parts = psJson(
    'Get-Partition | Select-Object DiskNumber,PartitionNumber,Size,GptType,DriveLetter,Type | ConvertTo-Json -Compress'
  );
  const diskArr = Array.isArray(disks) ? disks : disks ? [disks] : [];
  const partArr = Array.isArray(parts) ? parts : parts ? [parts] : [];

  return diskArr.map(d => ({
    id: String(d.Number),
    path: String(d.Number),
    name: `PhysicalDrive${d.Number}`,
    size: Number(d.Size) || 0,
    model: String(d.FriendlyName || '').trim(),
    removable: String(d.BusType || '').toUpperCase() === 'USB',
    transport: String(d.BusType || '').toUpperCase(),
    partitions: partArr
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
        esp: String(p.GptType || '').toLowerCase() === EFI_GUID,
      })),
  }));
}

function espPartition(disk) {
  if (!disk) {
    return null;
  }
  return disk.partitions.find(p => p.esp) || null;
}

function freeDriveLetter(used) {
  for (let c = 'Z'.charCodeAt(0); c >= 'D'.charCodeAt(0); c--) {
    const letter = String.fromCharCode(c);
    if (!used.includes(letter)) {
      return letter;
    }
  }
  throw new Error('No free drive letter available');
}

function mountEsp(partition) {
  const existing = psJson('Get-Partition | Select-Object DriveLetter | ConvertTo-Json -Compress');
  const letters = (Array.isArray(existing) ? existing : existing ? [existing] : [])
    .map(p => p.DriveLetter)
    .filter(Boolean);
  const letter = partition.driveLetter || freeDriveLetter(letters);

  ps(
    `Set-Partition -DiskNumber ${partition.diskNumber} -PartitionNumber ${partition.partitionNumber} -NewDriveLetter ${letter}`
  );
  return {
    mountDir: `${letter}:\\`,
    owned: !partition.driveLetter,
    handle: {
      diskNumber: partition.diskNumber,
      partitionNumber: partition.partitionNumber,
      letter,
    },
  };
}

function unmountEsp(handle) {
  if (!handle || !handle.handle || !handle.owned) {
    return;
  }
  const { diskNumber, partitionNumber, letter } = handle.handle;
  try {
    ps(
      `Remove-PartitionAccessPath -DiskNumber ${diskNumber} -PartitionNumber ${partitionNumber} -AccessPath ${letter}:\\`
    );
  } catch {
    /* best effort */
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
