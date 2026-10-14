#!/usr/bin/env node
// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Headless CLI: list devices, init or show the signed quota.
'use strict';

const service = require('../src/core/service');

function usage() {
  console.error('Usage: jemaos-quota <list | init --device <id> --limit <N> | show --device <id>>');
  process.exit(2);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      flags[key] = inline !== undefined ? inline : argv[++i];
    }
  }
  return flags;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const opts = { device: flags.device, limit: flags.limit, keyFile: flags.key };
  try {
    let result;
    if (cmd === 'list') {
      result = await service.scan();
    } else if (cmd === 'init') {
      result = await service.init(opts);
    } else if (cmd === 'show') {
      result = await service.show(opts);
    } else {
      usage();
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`jemaos-quota: ${error.message}`);
    process.exit(1);
  }
}

main();
