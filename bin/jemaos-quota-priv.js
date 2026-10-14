#!/usr/bin/env node
// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Elevated helper: performs the privileged ESP operation and prints the result
// as JSON on stdout. Invoked as root (pkexec / UAC) by the main process when it
// is not already elevated. NOT meant to be run directly by users.
'use strict';

const ops = require('../src/core/esp-ops');

function main() {
  const [action, rawParams] = process.argv.slice(2);
  let params = {};
  try {
    params = rawParams ? JSON.parse(rawParams) : {};
  } catch {
    process.stderr.write('invalid params');
    process.exit(2);
  }
  try {
    const result = ops[action](params);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(String(error.message || error));
    process.exit(1);
  }
}

main();
