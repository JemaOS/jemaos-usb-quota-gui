'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');

function load(relative, dependencies) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name),
    process, Buffer, console,
  }, { filename });
  return module.exports;
}

test('fsVolume reads, writes and reports existence under the mount directory', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jemaos-vol-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { fsVolume } = load('src/core/esp-volume.js', {});
  const vol = fsVolume(dir);
  assert.equal(vol.exists('efi/boot/jemaos-quota.cfg'), false);
  vol.write('efi/boot/jemaos-quota.cfg', 'hello');
  assert.equal(vol.exists('efi/boot/jemaos-quota.cfg'), true);
  assert.equal(vol.read('efi/boot/jemaos-quota.cfg'), 'hello');
  // The parent directory tree was created.
  assert.ok(fs.existsSync(path.join(dir, 'efi', 'boot')));
});

test('mtools volume accesses the FAT filesystem without mounting', () => {
  const calls = [];
  const files = new Map();
  const execFileSync = (cmd, args) => {
    calls.push([cmd, args]);
    const last = args[args.length - 1];
    const target = String(last).replace(/^::\//, '');
    if (cmd === 'mtype') {
      if (!files.has(target)) throw new Error('mtype: file not found');
      return files.get(target);
    }
    if (cmd === 'mmd') return '';
    if (cmd === 'mcopy') {
      const src = args[args.length - 2];
      files.set(target, fs.readFileSync(src, 'utf8'));
      return '';
    }
    throw new Error(`unexpected command: ${cmd}`);
  };
  const { mtools } = load('src/core/esp-volume.js', {
    'node:child_process': { execFileSync },
  });
  const vol = mtools('/dev/sda12');
  assert.equal(vol.exists('efi/boot/jemaos-quota.cfg'), false);
  vol.write('efi/boot/jemaos-quota.cfg', 'LIMIT=100');
  assert.equal(vol.exists('efi/boot/jemaos-quota.cfg'), true);
  assert.equal(vol.read('efi/boot/jemaos-quota.cfg'), 'LIMIT=100');
  // No mount/unmount is ever used.
  assert.ok(!calls.some(([cmd]) => cmd === 'mount' || cmd === 'umount'));
  // Parent directories are created with mmd, in order.
  const mmd = calls.filter(([cmd]) => cmd === 'mmd').map(([, args]) => args[args.length - 1]);
  assert.deepEqual(mmd, ['::/efi', '::/efi/boot']);
});

test('mtools writes with -o and reads the copy back from the device', () => {
  const writes = [];
  const execFileSync = (cmd, args) => {
    if (cmd === 'mcopy') { writes.push(args); return ''; }
    if (cmd === 'mtype') return 'X';
    if (cmd === 'mmd') return '';
    throw new Error('unexpected');
  };
  const { mtools } = load('src/core/esp-volume.js', { 'node:child_process': { execFileSync } });
  const vol = mtools('/dev/sda12');
  vol.write('efi/boot/jemaos-quota.cfg', 'DATA');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes('-o'), 'overwrite flag present');
  assert.ok(writes[0].includes('-i'));
  assert.equal(writes[0][writes[0].length - 1], '::/efi/boot/jemaos-quota.cfg');
});