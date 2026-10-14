// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Byte-compatibility + round-trip tests for the quota format.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const quota = require('../src/core/quota');
const { hmacHex } = require('../src/core/crypto');

const fs = require('node:fs');
const path = require('node:path');

test('HMAC matches the vendor vector (limit|used)', () => {
  const key = fs.readFileSync(
    path.join(__dirname, '..', 'resources', 'jemaos-quota.key'),
    'utf8'
  ).replace(/\n+$/, '');
  assert.strictEqual(
    hmacHex(key, '100|0'),
    'b5be7a5d8b07069aa7ceca8cd01172492de898044caaa8474fc18b72ea36abd2'
  );
});

test('render -> parse -> verify round-trip', () => {
  const key = 'unit-test-key';
  const content = quota.render(100, 0, key);
  assert.match(content, /^# JemaOS install quota - signed, do not edit\n/);
  assert.deepStrictEqual(quota.verify(content, key), { limit: 100, used: 0 });
});

test('tampering is rejected (fail-closed)', () => {
  const key = 'unit-test-key';
  const content = quota.render(100, 0, key);
  const tampered = content.replace('used=0', 'used=5');
  assert.strictEqual(quota.verify(tampered, key), null);
});

test('wrong key is rejected', () => {
  const content = quota.render(10, 2, 'key-a');
  assert.strictEqual(quota.verify(content, 'key-b'), null);
});
