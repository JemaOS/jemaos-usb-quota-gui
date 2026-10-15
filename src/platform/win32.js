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
const path = require('node:path').win32;
const { randomUUID } = require('node:crypto');

const EFI_GUID = 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b';
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const quote = value => `'${String(value).replace(/'/g, "''")}'`;

function normalizeGuid(value) {
  const text = String(value || '').trim().replace(/^\{(.+)\}$/, '$1').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text) ? text : '';
}

function normalizeDriveLetter(value) {
  const text = typeof value === 'number' ? String.fromCharCode(value) : String(value || '');
  return /^[a-z]$/i.test(text) ? text.toUpperCase() : null;
}

function normalizeBus(value) {
  if (value === 7 || value === '7') return 'USB';
  if (value === 17 || value === '17') return 'NVME';
  return String(value || '').toUpperCase();
}

function diskIdentity(disk) {
  return JSON.stringify([Number(disk.Number), String(disk.UniqueId || disk.SerialNumber || disk.FriendlyName || ''), Number(disk.Size)]);
}

function cleanPowerShellError(text) {
  return String(text || '')
    .replace(/#< CLIXML[\s\S]*$/i, '')
    .replace(/<Objs[\s\S]*$/i, '')
    .trim() || 'PowerShell command failed.';
}

function ps(script) {
  const body =
    "$ProgressPreference = 'SilentlyContinue'; " +
    "$ErrorActionPreference = 'Stop'; " +
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ' +
    script;
  try {
    return execFileSync(POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(body, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout: 30000, windowsHide: true });
  } catch (error) {
    const detail = String(error.stderr || error.message || error);
    if (/0x80070005|UnauthorizedAccess|PermissionDenied|access is denied|acc[eè]s (?:est )?refus[eé]|Access to the path/i.test(detail)) {
      const denied = new Error('Administrator authorization required to inspect storage devices.');
      denied.code = 'ADMIN_REQUIRED';
      throw denied;
    }
    // Drop PowerShell's CLIXML/progress noise so callers get a readable message.
    error.message = cleanPowerShellError(detail);
    throw error;
  }
}

// Runs an expression and always yields a JSON line ("null" when empty). This
// avoids the PowerShell 5.1 pitfall where an empty pipeline fed to
// ConvertTo-Json errors out under $ErrorActionPreference = 'Stop'.
function psJson(expression) {
  const wrapped =
    `$r = @(${expression}); ` +
    "if ($r.Count -eq 0) { Write-Output 'null' } else { Write-Output ($r | ConvertTo-Json -Compress) }";
  const out = ps(wrapped).replace(/^\uFEFF/, '');
  const line = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop();
  if (!line || line === 'null') {
    return null;
  }
  return JSON.parse(line);
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
    const probe = path.join(dir, `.jemaos-quota.${randomUUID()}.tmp`);
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function listDevices() {
  const disks = asArray(
    psJson('Get-Disk | Select-Object Number,FriendlyName,Size,BusType,UniqueId,SerialNumber,IsBoot,IsSystem')
  );
  const parts = asArray(
    psJson(
      'Get-Partition | Select-Object DiskNumber,PartitionNumber,Size,Offset,Guid,GptType,DriveLetter,Type,IsBoot,IsSystem,AccessPaths'
    )
  );

  return disks.map(d => {
    const partitions = parts.filter(p => Number(p.DiskNumber) === Number(d.Number)).map(p => {
      const letter = normalizeDriveLetter(p.DriveLetter);
      const volume =
        asArray(p.AccessPaths).find(x => typeof x === 'string' && x.startsWith('\\\\?\\Volume{')) || null;
      return {
        id: `${p.DiskNumber}:${p.PartitionNumber}`,
        diskNumber: Number(p.DiskNumber),
        partitionNumber: Number(p.PartitionNumber),
        diskIdentity: diskIdentity(d),
        guid: normalizeGuid(p.Guid),
        name: `Partition ${p.PartitionNumber}`,
        size: Number(p.Size) || 0,
        offset: Number(p.Offset) || 0,
        partType: normalizeGuid(p.GptType),
        driveLetter: letter,
        volume,
        mountpoint: letter ? `${letter}:\\` : null,
        esp: normalizeGuid(p.GptType) === EFI_GUID,
      };
    });
    return {
      id: String(d.Number), path: String(d.Number), name: `PhysicalDrive${d.Number}`,
      size: Number(d.Size) || 0, model: String(d.FriendlyName || '').trim(),
      removable: normalizeBus(d.BusType) === 'USB', transport: normalizeBus(d.BusType),
      systemDisk: Boolean(d.IsBoot || d.IsSystem || parts.some(p => Number(p.DiskNumber) === Number(d.Number) && (p.IsBoot || p.IsSystem))),
      identity: JSON.stringify([diskIdentity(d), partitions.filter(p => p.esp).map(p => [p.guid, p.offset, p.size])]),
      partitions,
    };
  });
}

function espPartition(disk) {
  const parts = disk ? disk.partitions.filter(p => p.esp) : [];
  return parts.length === 1 ? parts[0] : null;
}

function usedLetters() {
  return asArray(psJson('[System.IO.Directory]::GetLogicalDrives()'))
    .map(p => normalizeDriveLetter(String(p).slice(0, 1)))
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
      `(Get-Partition -DiskNumber ${diskNumber} -PartitionNumber ${partitionNumber} -ErrorAction Ignore).AccessPaths`
    )
  );
  try {
    const volume = psJson(`Get-Volume -Partition (Get-Partition -DiskNumber ${diskNumber} -PartitionNumber ${partitionNumber} -ErrorAction Ignore) -ErrorAction Ignore | Select-Object -ExpandProperty UniqueId`);
    paths.push(...asArray(volume));
  } catch { /* Some hidden ESPs have no Storage volume; fail safely below. */ }
  return paths.flat().find(p => typeof p === 'string' && p.startsWith('\\\\?\\Volume{')
    && p.endsWith('}\\') && normalizeGuid(p.slice(11, -2))) || null;
}

function currentPartition(partition) {
  const d = partition.diskNumber;
  const p = partition.partitionNumber;
  if (!Number.isSafeInteger(d) || d < 0 || !Number.isSafeInteger(p) || p < 1) {
    throw new Error('Invalid disk or partition identifier');
  }
  const disk = psJson(`Get-Disk -Number ${d} | Select-Object Number,FriendlyName,Size,BusType,UniqueId,SerialNumber,IsBoot,IsSystem`);
  const actual = psJson(`Get-Partition -DiskNumber ${d} -PartitionNumber ${p} | Select-Object DiskNumber,PartitionNumber,Size,Offset,Guid,GptType,DriveLetter,IsBoot,IsSystem`);
  if (!disk || !actual || normalizeBus(disk.BusType) !== 'USB' || disk.IsBoot || disk.IsSystem
      || actual.IsBoot || actual.IsSystem || diskIdentity(disk) !== partition.diskIdentity
      || normalizeGuid(actual.GptType) !== EFI_GUID || Number(actual.Offset) !== partition.offset
      || Number(actual.Size) !== partition.size || normalizeGuid(actual.Guid) !== partition.guid) {
    throw new Error('USB device or EFI partition changed; no changes were made.');
  }
  return actual;
}

function mappingMatches(letter, partition) {
  const mapped = psJson(`Get-Partition -DriveLetter ${letter} -ErrorAction Ignore | Select-Object DiskNumber,PartitionNumber,Size,Offset,Guid,GptType`);
  return mapped && !Array.isArray(mapped) && Number(mapped.DiskNumber) === partition.diskNumber
    && Number(mapped.PartitionNumber) === partition.partitionNumber && Number(mapped.Offset) === partition.offset
    && Number(mapped.Size) === partition.size && normalizeGuid(mapped.GptType) === EFI_GUID
    && normalizeGuid(mapped.Guid) === partition.guid;
}

function mountEsp(partition) {
  const d = partition.diskNumber;
  const p = partition.partitionNumber;
  currentPartition(partition);

  // Preferred: reach the partition through its volume GUID path
  // (\\?\Volume{GUID}\). Windows refuses Explorer / drive-letter access to the
  // EFI System Partition ("Access is denied"), but the volume path works.
  const volume = partition.volume || volumePath(d, p);
  if (volume && isWritable(volume)) {
    return {
      mountDir: volume,
      owned: false,
      handle: { partition, letter: null, volume },
    };
  }

  const existingLetter = normalizeDriveLetter(currentPartition(partition).DriveLetter);
  if (existingLetter) {
    if (!mappingMatches(existingLetter, partition) || !isWritable(`${existingLetter}:\\`)) {
      throw new Error('The selected EFI volume is not safely writable.');
    }
    return {
      mountDir: `${existingLetter}:\\`,
      owned: false,
      handle: { partition, letter: existingLetter, volume: null },
    };
  }

  const letter = freeDriveLetter();
  const accessPath = `${letter}:\\`;
  const handle = { mountDir: accessPath, owned: true, handle: { partition, letter, volume: null } };
  const strategies = [
    () => tryPs(`Set-Partition -DiskNumber ${d} -PartitionNumber ${p} -NewDriveLetter ${letter}`),
    () => tryPs(`Add-PartitionAccessPath -DiskNumber ${d} -PartitionNumber ${p} -AccessPath ${quote(accessPath)}`),
    () => {
      const volume = volumePath(d, p);
      if (!volume) return false;
      try {
        execFileSync(path.join(SYSTEM32, 'mountvol.exe'), [`${letter}:`, volume], { timeout: 20000, windowsHide: true });
        return true;
      } catch { return false; }
    },
  ];
  for (const attempt of strategies) {
    attempt();
    const matches = mappingMatches(letter, partition);
    if (matches === false || !matches && usedLetters().includes(letter)) {
      throw new Error('The temporary drive letter belongs to an unverified volume; no data was written.');
    }
    if (!matches) continue;
    try {
      currentPartition(partition);
      if (!isWritable(accessPath)) throw new Error('EFI volume is read-only.');
      return handle;
    } catch (error) {
      try { unmountEsp(handle); }
      catch (cleanup) { error.message += ` (cleanup: ${cleanup.message})`; }
      throw error;
    }
  }
  throw new Error(`Windows could not safely expose the selected EFI partition (${d}:${p}). No GPT attributes or data were changed.`);
}

function unmountEsp(handle) {
  // Volume-path access assigns nothing, so there is nothing to release.
  if (!handle || !handle.handle || !handle.owned || !handle.handle.letter) {
    return;
  }
  const { partition, letter } = handle.handle;
  const { diskNumber, partitionNumber } = partition;
  currentPartition(partition);
  if (!mappingMatches(letter, partition)) throw new Error('Mount changed; refusing to remove another volume.');
  const accessPath = `${letter}:\\`;
  if (
    !tryPs(
      `Remove-PartitionAccessPath -DiskNumber ${diskNumber} -PartitionNumber ${partitionNumber} -AccessPath ${quote(accessPath)}`
    )
  ) {
    execFileSync(path.join(SYSTEM32, 'mountvol.exe'), [`${letter}:`, '/D'], { timeout: 20000, windowsHide: true });
  }
  if (mappingMatches(letter, partition)) throw new Error('Could not remove the temporary EFI mount.');
}

module.exports = {
  platform: 'win32',
  needsElevation: true,
  isElevated,
  listDevices,
  espPartition,
  mountEsp,
  unmountEsp,
  normalizeGuid,
  normalizeDriveLetter,
  normalizeBus,
};
