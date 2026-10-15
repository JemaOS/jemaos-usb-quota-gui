// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
//
// A tiny volume abstraction used to read and write ONE file on the EFI System
// Partition:
//
//   - through a normal mount (node:fs) when mounting is allowed (Debian, macOS,
//     Windows, ...), or
//   - directly through mtools, which reads/writes the FAT filesystem WITHOUT
//     mounting it. This is required on ChromiumOS/ChromeOS: the Linux container
//     (Crostini) is an unprivileged user-namespace container and blocks mount(2)
//     by design ("Can I mount filesystems? Currently, no.").
//
// Interface: { kind, exists(rel), read(rel), write(rel, content) }
// `rel` is a path relative to the FAT root, e.g. "efi/boot/jemaos-quota.cfg".
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function fsVolume(mountDir) {
  return {
    kind: 'fs',
    exists: rel => fs.existsSync(path.join(mountDir, rel)),
    read: rel => fs.readFileSync(path.join(mountDir, rel), 'utf8'),
    write: (rel, content) => {
      const file = path.join(mountDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.new.${process.pid}`;
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, content);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, file);
    },
  };
}

function mtools(device) {
  // MTOOLS_SKIP_CHECK avoids geometry warnings on whole-device/partition nodes.
  const env = { ...process.env, MTOOLS_SKIP_CHECK: '1' };
  const run = (cmd, args, { timeout = 20000 } = {}) =>
    execFileSync(cmd, args, { encoding: 'utf8', timeout, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const target = rel => `::/${rel}`;

  function ensureParentDirs(rel) {
    const parts = rel.split('/').filter(Boolean);
    let acc = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      acc += `${acc ? '/' : ''}${parts[i]}`;
      try {
        run('mmd', ['-i', device, `::/${acc}`]);
      } catch {
        /* directory already exists */
      }
    }
  }

  return {
    kind: 'mtools',
    exists(rel) {
      try {
        run('mtype', ['-i', device, target(rel)]);
        return true;
      } catch {
        return false;
      }
    },
    read(rel) {
      return run('mtype', ['-i', device, target(rel)]);
    },
    write(rel, content) {
      ensureParentDirs(rel);
      const tmp = path.join(os.tmpdir(), `jemaos-quota.${process.pid}.${Date.now()}.cfg`);
      fs.writeFileSync(tmp, content);
      try {
        run('mcopy', ['-o', '-i', device, tmp, target(rel)], { timeout: 30000 });
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* best effort */
        }
      }
    },
  };
}

// True when the mtools binaries are available (so the no-mount fallback works).
function mtoolsAvailable() {
  try {
    execFileSync('mcopy', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 5000 });
    return true;
  } catch {
    try {
      execFileSync('mtype', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { fsVolume, mtools, mtoolsAvailable };