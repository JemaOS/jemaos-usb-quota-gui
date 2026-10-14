'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Linux DMG build wraps an HFS+ volume with "dmg build" (not "dmg dmg")', () => {
  const script = read('scripts/build-macos-dmg.sh');
  assert.match(script, /"\$DMG" build "\$RAW" "\$OUT"/);
  assert.doesNotMatch(script, /"\$DMG" dmg /);
  assert.match(script, /mkfs\.hfsplus/);
  assert.match(script, /clone_link/);
  assert.match(script, /roundtrip\.raw/);
});

test('DMG tooling is fetched from pinned, verified sources', () => {
  const fetch = read('scripts/fetch-dmg-tools.sh');
  assert.match(fetch, /hfsprogs_540\.1\.linux3-5build3_amd64\.deb/);
  assert.match(fetch, /21aab68916cdba913b8571f1d83285f958878d2378255ee87a225575b917b77f/);
  assert.match(fetch, /apple-codesign\/0\.29\.0/);
  assert.match(fetch, /dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002/);
  assert.match(fetch, /libdmg-hfsplus/);
  assert.match(fetch, /e18579b391950589b9ed16ee630c54ce4319bb29/);
});

test('one-command macOS build on Linux is wired and documented', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts['dist:mac:linux'], 'bash scripts/dist-macos-on-linux.sh');
  assert.equal(pkg.scripts['dist:mac:dir'], 'npm run dist -- --mac dir --x64 --arm64 --publish never');
  const readme = read('README.md');
  assert.match(readme, /dist:mac:linux/);
  assert.match(readme, /libdmg-hfsplus/);
});