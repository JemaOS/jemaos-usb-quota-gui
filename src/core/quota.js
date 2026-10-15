// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// The signed quota counter file on the USB EFI System Partition.
//
// Format (GRUB-sourceable):
//   # JemaOS install quota - signed, do not edit
//   set jemaos_quota_limit=100
//   set jemaos_quota_used=0
//   set jemaos_quota_sig=<hmac-sha256-hex of "limit|used">
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { hmacHex } = require('./crypto');

const QUOTA_NAME = 'jemaos-quota.cfg';
const ESP_SUBDIR = 'efi/boot';
const HEADER = '# JemaOS install quota - signed, do not edit';

function isDigits(value) {
  return typeof value === 'string' && /^[0-9]+$/.test(value);
}

/** HMAC over the "limit|used" payload (exactly as the installer does). */
function sign(limit, used, key) {
  return hmacHex(key, `${limit}|${used}`);
}

/** Render the full counter file content. */
function render(limit, used, key) {
  return (
    `${HEADER}\n` +
    `set jemaos_quota_limit=${limit}\n` +
    `set jemaos_quota_used=${used}\n` +
    `set jemaos_quota_sig=${sign(limit, used, key)}\n`
  );
}

function field(content, name) {
  const match = content.match(new RegExp(`^set ${name}=(.*)$`, 'm'));
  return match ? match[1] : null;
}

/** Parse the counter (no signature check). Returns null if malformed. */
function parse(content) {
  if (typeof content !== 'string') {
    return null;
  }
  const limit = field(content, 'jemaos_quota_limit');
  const used = field(content, 'jemaos_quota_used');
  const sig = field(content, 'jemaos_quota_sig');
  if (!isDigits(limit) || !isDigits(used)) {
    return null;
  }
  return { limit: Number(limit), used: Number(used), sig };
}

/** Parse + verify signature. Returns {limit, used} or null when invalid. */
function verify(content, key) {
  const parsed = parse(content);
  if (!parsed) {
    return null;
  }
  if (parsed.sig !== sign(parsed.limit, parsed.used, key)) {
    return null;
  }
  return { limit: parsed.limit, used: parsed.used };
}

/** Absolute path of the counter file for a mounted ESP. */
function quotaPath(espMount) {
  return path.join(espMount, ESP_SUBDIR, QUOTA_NAME);
}

/** Path of the counter file relative to the FAT root (e.g. for mtools). */
const QUOTA_REL = `${ESP_SUBDIR}/${QUOTA_NAME}`;

/** Create parent dirs and write atomically (temp file + fsync + rename). */
function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.new.${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

module.exports = {
  QUOTA_NAME,
  ESP_SUBDIR,
  QUOTA_REL,
  HEADER,
  sign,
  render,
  parse,
  verify,
  quotaPath,
  writeAtomic,
};
