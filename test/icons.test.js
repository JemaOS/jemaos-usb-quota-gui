'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateIcons } = require('../scripts/generate-icons');

test('USB logo generates valid PNG, ICO and ICNS containers for the installers', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-icons-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'ui'));
  fs.copyFileSync(path.join(__dirname, '..', 'ui', 'logo.svg'), path.join(dir, 'ui', 'logo.svg'));
  generateIcons(dir);
  const png = fs.readFileSync(path.join(dir, 'assets', 'icon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    const icon = fs.readFileSync(path.join(dir, 'assets', 'linux', `${size}x${size}.png`));
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
  const ico = fs.readFileSync(path.join(dir, 'assets', 'icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  for (let index = 0; index < 6; index++) {
    const length = ico.readUInt32LE(6 + index * 16 + 8);
    const offset = ico.readUInt32LE(6 + index * 16 + 12);
    assert.equal(ico.subarray(offset + 1, offset + 4).toString(), 'PNG');
    assert.ok(offset + length <= ico.length);
  }
  const icns = fs.readFileSync(path.join(dir, 'assets', 'icon.icns'));
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.equal(icns.subarray(8, 12).toString(), 'ic07');
});
