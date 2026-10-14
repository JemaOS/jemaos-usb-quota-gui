'use strict';

const test = require('node:test');
const linuxTest = process.platform === 'linux' ? test : test.skip;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const afterPack = require('../scripts/afterPack');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appOutDir = path.join(root, 'opt', 'Quota JemaOS');
  fs.mkdirSync(appOutDir, { recursive: true });
  const launcher = path.join(appOutDir, 'quota-jemaos');
  fs.writeFileSync(launcher, `#!${process.execPath}
console.log(JSON.stringify({ args: process.argv.slice(2), nodeMode: process.env.ELECTRON_RUN_AS_NODE || null }));
`, { mode: 0o755 });
  const context = { electronPlatformName: 'linux', appOutDir, packager: { executableName: 'quota-jemaos' } };
  await afterPack(context);
  return { root, launcher, context };
}

function launch(file, args, extraEnv = {}) {
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extraEnv },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

linuxTest('native wrapper supports an app path and arguments containing spaces', async t => {
  const { launcher } = await fixture(t);
  assert.deepEqual(launch(launcher, ['--smoke-test', 'a file.txt']), {
    args: ['--no-sandbox', '--smoke-test', 'a file.txt'],
    nodeMode: null,
  });
});

linuxTest('installed alternatives symlink resolves the real app directory', async t => {
  const { root, launcher } = await fixture(t);
  const bin = path.join(root, 'usr', 'bin');
  const alternatives = path.join(root, 'etc', 'alternatives');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(alternatives, { recursive: true });
  const target = path.join(alternatives, 'quota-jemaos');
  fs.symlinkSync(launcher, target);
  const link = path.join(bin, 'quota-jemaos');
  fs.symlinkSync(path.relative(bin, target), link);
  assert.deepEqual(launch(link, ['--smoke-test']).args, ['--no-sandbox', '--smoke-test']);
});

linuxTest('command lookup on PATH uses the installed symlink', async t => {
  const { root, launcher } = await fixture(t);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(launcher, path.join(bin, 'quota-jemaos'));
  assert.deepEqual(launch('quota-jemaos', ['--smoke-test'], { PATH: `${bin}:${process.env.PATH}` }).args,
    ['--no-sandbox', '--smoke-test']);
});

linuxTest('afterPack does not replace the real binary when called twice', async t => {
  const { launcher, context } = await fixture(t);
  const contents = fs.readFileSync(`${launcher}-bin`, 'utf8');
  await afterPack(context);
  assert.equal(fs.readFileSync(`${launcher}-bin`, 'utf8'), contents);
  assert.equal(launch(launcher, []).nodeMode, null);
});

linuxTest('packaged app starts through an installed alternatives link without USB access', {
  skip: !process.env.QUOTA_PACKAGED_DIR,
}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-packaged-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'usr', 'bin');
  const alternatives = path.join(root, 'etc', 'alternatives');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(alternatives, { recursive: true });
  const app = path.join(process.env.QUOTA_PACKAGED_DIR, 'quota-jemaos');
  const target = path.join(alternatives, 'quota-jemaos');
  fs.symlinkSync(app, target);
  const link = path.join(bin, 'quota-jemaos');
  fs.symlinkSync(target, link);
  const result = spawnSync(link, ['--smoke-test'], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout.split('\n').find(line => line.startsWith('{"native":true'));
  assert.ok(output, `Missing native launch result: ${result.stdout}`);
  assert.deepEqual(JSON.parse(output), {
    native: true,
    protocol: 'file:',
    platform: 'linux',
    devices: 0,
  });
});
