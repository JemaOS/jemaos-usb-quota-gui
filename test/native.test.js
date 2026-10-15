'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');

function load(relative, dependencies, globals = {}) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name),
    process, Buffer, console, ...globals,
  }, { filename });
  return module.exports;
}

function mainFixture(platform, smoke = false) {
  const handlers = new Map();
  const switches = [];
  const called = { operations: 0 };
  let window;
  const app = { commandLine: { appendSwitch: value => switches.push(value) },
    disableHardwareAcceleration() {}, whenReady: () => ({ then: fn => fn() }), on() {}, exit() {},
    getPath: () => '/fixture/quota-jemaos.exe' };
  const electron = { app, ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    BrowserWindow: class {
      constructor(options) {
        this.options = options;
        this.webContents = { mainFrame: { url: pathToFileURL(path.join(root, 'ui', 'index.html')).href },
          on() {}, once() {}, setWindowOpenHandler: fn => { called.openWindow = fn; } };
        window = this;
      }
      loadFile(filename) { called.file = filename; }
    } };
  // On Windows the packaged app runs the elevated instance; mirror that here so
  // the elevation check does not spawn PowerShell during tests.
  const argv = smoke ? ['app', '--smoke-test']
    : platform === 'win32' ? ['app', '--elevated'] : ['app'];
  load('electron/main.js', {
    electron,
    'node:fs': { existsSync: () => true },
    '../src/core/service': { resolveKey: () => '/fixture/key', scan: () => { called.operations++; return []; },
      show: () => { called.operations++; return {}; }, init: () => { called.operations++; return {}; } },
    '../src/platform': { platform, isElevated: () => false, needsElevation: true },
  }, { process: { platform, argv, env: {} } });
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return { handlers, switches, called, window, event };
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform} native renderer keeps the Chromium sandbox`, () => {
    const fixture = mainFixture(platform);
    assert.equal(fixture.window.options.webPreferences.sandbox, true);
    assert.equal(fixture.switches.includes('no-sandbox'), false);
    assert.equal(fixture.called.file, path.join(root, 'ui', 'index.html'));
    assert.equal(fixture.called.openWindow().action, 'deny');
  });
}

test('foreign windows and child frames cannot call the privileged IPC', () => {
  const fixture = mainFixture('linux');
  assert.throws(() => fixture.handlers.get('init')({ sender: {}, senderFrame: {} }, { device: '2', limit: 100 }), /Unauthorized/);
  const event = fixture.event();
  event.senderFrame = { ...event.senderFrame };
  assert.throws(() => fixture.handlers.get('show')(event, { device: '2' }), /Unauthorized/);
  assert.equal(fixture.called.operations, 0);
});

test('invalid IPC payloads are rejected before any service operation', () => {
  const fixture = mainFixture('linux');
  for (const payload of [null, [], { device: '2', limit: -1 }, { device: '2', limit: 1.2 },
    { device: '2', limit: '100' }, { device: '2', limit: 100, keyFile: '/secret' }]) {
    assert.throws(() => fixture.handlers.get('init')(fixture.event(), payload), /Invalid/);
  }
  assert.equal(fixture.called.operations, 0);
});

test('launch smoke test cannot scan, mount or write any real USB device', () => {
  const fixture = mainFixture('linux', true);
  assert.equal(fixture.handlers.get('devices')(fixture.event()).length, 0);
  assert.throws(() => fixture.handlers.get('show')(fixture.event(), {}), /disabled/);
  assert.throws(() => fixture.handlers.get('init')(fixture.event(), {}), /disabled/);
  assert.equal(fixture.called.operations, 0);
});

test('preload rejects unknown channels and forwards only the native actions', async () => {
  let bridge;
  const calls = [];
  load('electron/preload.js', { electron: {
    contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } },
    ipcRenderer: { invoke: async (action, payload) => { calls.push({ action, payload }); return 'ok'; } },
  } });
  await assert.rejects(bridge.invoke('arbitrary-channel'), /Unsupported/);
  assert.equal(await bridge.invoke('devices'), 'ok');
  assert.equal(calls.length, 1);
});

test('macOS internal build signs the bundle ad-hoc without inventing a trusted publisher', async () => {
  let options;
  const sign = load('scripts/sign-mac.js', { '@electron/osx-sign': {
    signAsync: async value => { options = value; },
  } });
  await sign({ app: '/fixture/Quota JemaOS.app', entitlements: '/fixture/entitlements.plist' });
  assert.equal(options.identity, '-');
  assert.equal(options.identityValidation, false);
  assert.equal(options.entitlements, '/fixture/entitlements.plist');
  await sign({ app: '/fixture/Quota JemaOS.app', identity: 'fixture-valid-developer-id' });
  assert.equal(options.identity, 'fixture-valid-developer-id');
});

test('old server and bootstrap launchers are absent from the native project', () => {
  for (const file of ['server.js', 'start.sh', 'start.command', 'Start Windows.cmd', 'bin/jemaos-quota-app.js', 'install-desktop.sh']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
  const packageJson = require('../package.json');
  assert.equal(packageJson.scripts.start, 'node scripts/start-native.js');
  assert.ok(!packageJson.build.files.includes('server.js'));
  const renderer = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
  assert.doesNotMatch(renderer, /fetch\(|\/api\//);
});

function opsFixture(device, cleanupError) {
  const called = { mounted: 0, written: 0, cleaned: 0, key: 0 };
  const exported = load('src/core/esp-ops.js', {
    'node:fs': { readFileSync: () => 'fixture' },
    '../platform': { listDevices: () => [device], espPartition: disk => disk.partitions[0],
      mountEsp: () => { called.mounted++; return { mountDir: '/fixture/ESP' }; },
      unmountEsp: () => { called.cleaned++; if (cleanupError) throw cleanupError; } },
    './crypto': { loadKey: () => { called.key++; return 'fixture'; } },
    './quota': { quotaPath: () => '/fixture/quota', render: () => 'fixture',
      writeAtomic: () => { called.written++; }, verify: () => ({ limit: 100, used: 0 }) },
  });
  return { ops: exported, called };
}

const usb = { id: '2', removable: true, systemDisk: false, identity: 'expected-device', partitions: [{ id: '2:12', esp: true }] };

for (const [label, disk, identity] of [
  ['internal disk', { ...usb, removable: false }, undefined],
  ['system disk', { ...usb, systemDisk: true }, undefined],
  ['replaced USB', { ...usb, identity: 'replacement' }, 'expected-device'],
  ['multiple ESPs', { ...usb, partitions: [...usb.partitions, { id: '2:1', esp: true }] }, undefined],
]) {
  test(`unsafe target is rejected before any write: ${label}`, () => {
    const { ops, called } = opsFixture(disk);
    assert.throws(() => ops.init({ device: '2', identity, limit: 100 }));
    assert.equal(called.mounted, 0);
    assert.equal(called.written, 0);
    assert.equal(called.key, 0);
  });
}

test('unmount failure is surfaced instead of announcing a fully completed operation', () => {
  const { ops, called } = opsFixture(usb, new Error('cleanup fixture'));
  assert.throws(() => ops.init({ device: '2', limit: 100 }), /cleanup fixture/);
  assert.equal(called.cleaned, 1);
});
