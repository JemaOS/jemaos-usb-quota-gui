#!/usr/bin/env node
// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Elevated helper (runs as root/admin). Reads params from a file, performs the
// privileged ESP operation, and writes the JSON result (or {error}) to an
// output file so the caller can capture it regardless of how it was elevated.
//
//   helper <action> <paramsFile> <outFile>
'use strict';

const fs = require('node:fs');
const ops = require('../src/core/esp-ops');

function main() {
  const [action, paramsFile, outFile] = process.argv.slice(2);
  let params = {};
  try {
    params = JSON.parse(fs.readFileSync(paramsFile, 'utf8'));
  } catch {
    params = {};
  }
  let result;
  let code = 0;
  try {
    result = ops[action](params);
  } catch (error) {
    result = { error: String((error && error.message) || error) };
    code = 1;
  }
  try {
    fs.writeFileSync(outFile, JSON.stringify(result));
  } catch {
    /* nothing else we can do */
  }
  process.exit(code);
}

main();
