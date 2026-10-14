// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// HMAC helpers, byte-compatible with the vendor CLI:
//   printf '%s' "$msg" | openssl dgst -sha256 -hmac "$(cat KEY)"
//
// Note: `$(cat KEY)` strips trailing newlines, so the effective key is the key
// file content without any trailing \n. The digest is lowercase hex.
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * Load the HMAC key the same way the shell does (`$(cat file)`).
 * @param {string} keyPath
 * @returns {string}
 */
function loadKey(keyPath) {
  return fs.readFileSync(keyPath, 'utf8').replace(/\n+$/, '');
}

/**
 * @param {string} key
 * @param {string} message
 * @returns {string} lowercase hex HMAC-SHA256
 */
function hmacHex(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

module.exports = { loadKey, hmacHex };
