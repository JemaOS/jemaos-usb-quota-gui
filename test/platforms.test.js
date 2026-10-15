'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(relative, dependencies) {
  const filename = path.join(__dirname, '..', relative);
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name),
    process, Buffer, console,
  }, { filename });
  return module.exports;
}

const windows = require('../src/platform/win32');
const EFI = 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b';
const GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('Windows normalizes the USB bus, Char16 drive letters and EFI GUID', () => {
  assert.equal(windows.normalizeBus(7), 'USB');
  assert.equal(windows.normalizeBus('USB'), 'USB');
  for (const value of [null, '', '\u0000', 0, 'not-a-letter']) assert.equal(windows.normalizeDriveLetter(value), null);
  for (const value of ['z', 'Z', 90]) assert.equal(windows.normalizeDriveLetter(value), 'Z');
  assert.equal(windows.normalizeGuid(` {${EFI.toUpperCase()}} `), EFI);
  assert.equal(windows.normalizeGuid(EFI), EFI);
  assert.equal(windows.normalizeGuid('System'), '');
});

function windowsFixture(config = {}) {
  const calls = { commands: [], probes: [], removed: 0 };
  let mapped = Boolean(config.borrowed);
  let race = false;
  const disk = { Number: 2, FriendlyName: 'USB fixture', Size: 32e9, BusType: 7,
    UniqueId: 'fixture-USB-identity', IsBoot: false, IsSystem: false };
  const part = { DiskNumber: 2, PartitionNumber: 12, Size: 32e6, Offset: 4000000,
    Guid: GUID, GptType: EFI, DriveLetter: '\u0000', Type: 'System' };
  const volume = `\\\\?\\Volume{${GUID}}\\`;
  const accessPaths = config.noVolume ? [] : [volume];
  const childProcess = {
    execFileSync: (file, args) => {
      if (file.endsWith('mountvol.exe')) {
        calls.commands.push({ native: true, file, args });
        if (args[1] === '/D') { mapped = false; calls.removed++; }
        else { assert.equal(args[1], volume); mapped = true; }
        return '';
      }
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      calls.commands.push(script);
      if (script.includes('disks = ')) {
        return JSON.stringify({ disks: [disk], parts: [{ ...part, AccessPaths: accessPaths, GptType: config.wrongGuid ? GUID : EFI }] });
      }
      if (script.includes('disk = ')) {
        return JSON.stringify({ disk, part: { ...part, DriveLetter: mapped ? 'Y' : '\u0000' } });
      }
      if (script.includes('GetLogicalDrives')) return JSON.stringify(['C:\\', 'Z:\\']);
      if (script.includes('Get-Partition -DriveLetter')) {
        if (config.wrongVolume || race) return JSON.stringify({ ...part, DiskNumber: 9 });
        return mapped ? JSON.stringify({ ...part, DriveLetter: 'Y' }) : '';
      }
      if (script.includes('.AccessPaths')) return JSON.stringify(accessPaths);
      if (script.includes('Get-Volume -Partition')) return config.noVolume ? '' : JSON.stringify(volume);
      if (script.includes('Set-Partition') || script.includes('Add-PartitionAccessPath')) {
        if (config.storageDenied || config.wrongVolume) throw new Error('assignment refused');
        mapped = true;
        return '';
      }
      if (script.includes('Remove-PartitionAccessPath')) {
        mapped = false;
        calls.removed++;
        return '';
      }
      throw new Error(`Unexpected fixture command: ${script}`);
    },
  };
  const backend = load('src/platform/win32.js', {
    'node:child_process': childProcess,
    'node:fs': { writeFileSync: (file, _value, options) => {
      calls.probes.push(file);
      assert.equal(options.flag, 'wx');
      if (config.probeError) throw new Error('read only fixture');
      if (config.volumeReadOnly && String(file).includes('Volume{')) throw new Error('volume read-only fixture');
    }, unlinkSync() {} },
  });
  return { backend, calls, race: () => { race = true; } };
}

test('a contradictory System type never substitutes for the EFI GUID', () => {
  const { backend } = windowsFixture({ wrongGuid: true });
  assert.equal(backend.listDevices()[0].partitions[0].esp, false);
});

test('Windows reaches the ESP through its volume GUID path, without a drive letter', () => {
  const { backend, calls } = windowsFixture();
  const partition = backend.listDevices()[0].partitions[0];
  const handle = backend.mountEsp(partition);
  assert.equal(handle.mountDir, `\\\\?\\Volume{${GUID}}\\`);
  assert.equal(handle.owned, false);
  assert.ok(!calls.commands.some(c => typeof c === 'string' && c.includes('-NewDriveLetter')));
  backend.unmountEsp(handle);
  assert.equal(calls.removed, 0);
});

test('read-only access (verify:false) skips the live re-verification round-trip', () => {
  const { backend, calls } = windowsFixture();
  const partition = backend.listDevices()[0].partitions[0];
  const before = calls.commands.length;
  const handle = backend.mountEsp(partition, { verify: false });
  assert.equal(handle.mountDir, `\\\\?\\Volume{${GUID}}\\`);
  assert.equal(calls.commands.length, before, 'no PowerShell round-trip for read-only access');
});

test('a write (verify default) re-verifies the live target before mounting', () => {
  const { backend, calls } = windowsFixture();
  const partition = backend.listDevices()[0].partitions[0];
  const before = calls.commands.length;
  backend.mountEsp(partition, { verify: true });
  assert.ok(calls.commands.slice(before).some(c => typeof c === 'string' && c.includes('disk = ')),
    'write path issues a live re-verification');
});

test('Windows falls back to a temporary drive letter when no volume path is available', () => {
  const { backend, calls } = windowsFixture({ noVolume: true });
  const partition = backend.listDevices()[0].partitions[0];
  const handle = backend.mountEsp(partition);
  assert.equal(handle.mountDir, 'Y:\\');
  assert.equal(calls.probes.length, 1);
  assert.ok(calls.commands.some(c => typeof c === 'string' && c.includes('-NewDriveLetter Y')));
  backend.unmountEsp(handle);
  assert.equal(calls.removed, 1);
});

test('wrong drive mapping can never receive a probe or be removed', () => {
  const { backend, calls } = windowsFixture({ noVolume: true, wrongVolume: true });
  const partition = backend.listDevices()[0].partitions[0];
  assert.throws(() => backend.mountEsp(partition), /unverified volume/);
  assert.equal(calls.probes.length, 0);
  assert.equal(calls.removed, 0);
});

test('mountvol fallback passes the selected volume GUID as a single native argument', () => {
  const { backend, calls } = windowsFixture({ volumeReadOnly: true, storageDenied: true });
  const partition = backend.listDevices()[0].partitions[0];
  const handle = backend.mountEsp(partition);
  assert.equal(handle.mountDir, 'Y:\\');
  const native = calls.commands.find(c => c.native);
  assert.equal(native.args[0], 'Y:');
  assert.equal(native.args.length, 2);
  assert.ok(!calls.commands.some(c => c.native && c.args.includes('/S')));
});

test('a drive mapping changed after mount is not removed', () => {
  const fixture = windowsFixture({ noVolume: true });
  const handle = fixture.backend.mountEsp(fixture.backend.listDevices()[0].partitions[0]);
  fixture.race();
  assert.throws(() => fixture.backend.unmountEsp(handle), /refusing/);
  assert.equal(fixture.calls.removed, 0);
});

test('Windows cleans a newly acquired mount after write access fails', () => {
  const { backend, calls } = windowsFixture({ noVolume: true, probeError: true });
  assert.throws(() => backend.mountEsp(backend.listDevices()[0].partitions[0]), /read-only/);
  assert.equal(calls.removed, 1);
});

test('Windows never removes a borrowed pre-existing mount', () => {
  const { backend, calls } = windowsFixture({ noVolume: true, borrowed: true });
  const handle = backend.mountEsp(backend.listDevices()[0].partitions[0]);
  assert.equal(handle.owned, false);
  assert.equal(handle.mountDir, 'Y:\\');
  backend.unmountEsp(handle);
  assert.equal(calls.removed, 0);
});

function macFixture(config = {}) {
  const calls = { commands: [], probes: 0, removed: 0, manualMount: 0, directoriesRemoved: 0, remounts: 0 };
  let mounted = Boolean(config.borrowed);
  let mountDir = '/Volumes/USB EFI';
  let readOnly = Boolean(config.readOnly);
  const partition = { DeviceIdentifier: 'disk2s1', ParentWholeDisk: 'disk2', Content: 'EFI',
    TotalSize: 32e6, VolumeUUID: GUID };
  const childProcess = {
    execFileSync: (file, args) => {
      calls.commands.push({ file, args });
      if (file === '/sbin/mount') {
        if (args[0] === '-u') { readOnly = false; calls.remounts++; return ''; }
        mounted = true; mountDir = args.at(-1); calls.manualMount++; return '';
      }
      if (args[0] === 'list') return JSON.stringify({ AllDisksAndPartitions: [{ DeviceIdentifier: 'disk2', Size: 32e9,
        Partitions: [{ DeviceIdentifier: 'disk2s1', Content: 'EFI', Size: 32e6, VolumeUUID: GUID }] }] });
      if (args[0] === 'info') {
        const target = args.at(-1);
        if (target === '/') return JSON.stringify({ ParentWholeDisk: 'disk0', FilesystemType: 'hfs' });
        if (target === 'disk2') return JSON.stringify({ Internal: false, VirtualOrPhysical: 'Physical', MediaName: 'USB fixture', BusProtocol: 'USB' });
        return JSON.stringify({ ...partition, ParentWholeDisk: config.wrongParent ? 'disk0' : 'disk2', MountPoint: mounted ? mountDir : undefined });
      }
      if (args[0] === 'mount') { if (config.mountError) throw new Error('mount fixture refused'); mounted = true; readOnly = Boolean(config.readOnly); return ''; }
      if (args[0] === 'unmount') { mounted = false; calls.removed++; return ''; }
      throw new Error('Unexpected macOS fixture command');
    },
    spawnSync: (_file, _args, options) => config.badPlist
      ? { status: 1, stderr: 'invalid plist fixture' }
      : { status: 0, stdout: options.input },
  };
  const backend = load('src/platform/darwin.js', {
    'node:child_process': childProcess,
    'node:fs': { mkdtempSync: () => '/fixture/ESP folder',
      writeFileSync: (_file, _value, options) => {
        assert.equal(options.flag, 'wx');
        if (readOnly) { const e = new Error('read only fixture'); e.code = 'EROFS'; throw e; }
        calls.probes++;
        if (config.probeError) throw new Error('probe refused');
      },
      unlinkSync() {}, rmdirSync: () => { calls.directoriesRemoved++; } },
  });
  return { backend, calls };
}

test('macOS remounts a read-only EFI partition read-write before a write', () => {
  const { backend, calls } = macFixture({ borrowed: true, readOnly: true });
  const handle = backend.mountEsp(backend.listDevices()[0].partitions[0], { writable: true });
  assert.equal(handle.mountDir, '/Volumes/USB EFI');
  assert.ok(calls.remounts >= 1, 'remounted read-write');
  assert.ok(calls.commands.some(c => c.file === '/sbin/mount' && c.args[0] === '-u' && c.args[1] === '-w'));
});

test('macOS read-only mount is accepted for reading (no remount)', () => {
  const { backend, calls } = macFixture({ borrowed: true, readOnly: true });
  const handle = backend.mountEsp(backend.listDevices()[0].partitions[0], { writable: false });
  assert.equal(handle.mountDir, '/Volumes/USB EFI');
  assert.equal(calls.remounts, 0);
});

test('macOS uses an identified EFI partition, not a mount point guessed from its name', () => {
  const { backend, calls } = macFixture();
  const handle = backend.mountEsp(backend.listDevices()[0].partitions[0]);
  assert.equal(handle.mountDir, '/Volumes/USB EFI');
  backend.unmountEsp(handle);
  const unmount = calls.commands.find(command => command.args[0] === 'unmount');
  assert.equal(unmount.args[1], '/dev/disk2s1');
});

test('macOS rolls back a new mount if write verification fails', () => {
  const { backend, calls } = macFixture({ probeError: true });
  assert.throws(() => backend.mountEsp(backend.listDevices()[0].partitions[0], { writable: true }), /writable|read-only/);
  assert.equal(calls.removed, 1);
});

test('macOS does not unmount a borrowed volume', () => {
  const { backend, calls } = macFixture({ borrowed: true });
  const handle = backend.mountEsp(backend.listDevices()[0].partitions[0]);
  assert.equal(handle.owned, false);
  backend.unmountEsp(handle);
  assert.equal(calls.removed, 0);
});

test('macOS invalid plist is an error, not a signal to mount something else', () => {
  const { backend, calls } = macFixture({ badPlist: true });
  assert.throws(() => backend.listDevices(), /plutil failed/);
  assert.equal(calls.manualMount, 0);
});

test('macOS rejects a partition belonging to a different parent disk before mounting', () => {
  const { backend, calls } = macFixture({ wrongParent: true });
  assert.throws(() => backend.mountEsp(backend.listDevices()[0].partitions[0]), /changed/);
  assert.equal(calls.commands.filter(command => command.args[0] === 'mount').length, 0);
  assert.equal(calls.probes, 0);
});

test('macOS fallback preserves paths containing spaces and removes only its own temporary directory', () => {
  const { backend, calls } = macFixture({ mountError: true });
  const handle = backend.mountEsp(backend.listDevices()[0].partitions[0]);
  assert.equal(handle.mountDir, '/fixture/ESP folder');
  backend.unmountEsp(handle);
  assert.equal(calls.manualMount, 1);
  assert.equal(calls.directoriesRemoved, 1);
});
