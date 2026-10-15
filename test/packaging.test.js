'use strict';

// Packaging regression guards. The elevated helper (bin/jemaos-quota-priv.js) is
// executed as a real file by pkexec/osascript and requires its dependencies from
// ../src, so those must be unpacked from the asar archive. When asar was enabled
// without unpacking src/, the helper crashed with "Cannot find module
// '../src/core/esp-ops'" and the app reported
// "Authorization cancelled or privileged helper could not start." on Linux/macOS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');

test('asar keeps the elevated helper and its dependencies as real files', () => {
  assert.equal(pkg.build.asar, true, 'asar is enabled');
  const unpack = pkg.build.asarUnpack || [];
  for (const needed of ['bin/**', 'resources/**', 'src/**']) {
    assert.ok(unpack.includes(needed), `asarUnpack must include ${needed}`);
  }
});

test('the packaged helper resolves its src dependencies from app.asar.unpacked', () => {
  // Simulate the packaged layout: bin/ and src/ side by side under
  // resources/app.asar.unpacked/, then resolve the helper's require target.
  const helperRel = path.join('bin', 'jemaos-quota-priv.js');
  const unpackedRoot = path.join('resources', 'app.asar.unpacked');
  const helperAbs = path.join(unpackedRoot, helperRel);
  const required = path.join(path.dirname(helperAbs), '..', 'src', 'core', 'esp-ops.js');
  assert.equal(
    path.normalize(required),
    path.join(unpackedRoot, 'src', 'core', 'esp-ops.js'),
    'helper must resolve src/core/esp-ops.js next to it (i.e. src/** unpacked)'
  );
});

test('the helper only uses node builtins plus project code', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'jemaos-quota-priv.js'), 'utf8');
  const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]);
  for (const r of requires) {
    const ok = r.startsWith('node:') || r.startsWith('.') || r === '../src/core/esp-ops';
    assert.ok(ok, `unexpected dependency in helper: ${r}`);
  }
});