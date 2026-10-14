#!/usr/bin/env node
// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
// Elevated helper (runs as root/admin). Reads params from a file, performs the
// privileged ESP operation, and writes the JSON result (or {error}) to an
// output file so the caller can capture it regardless of how it was elevated.
//
//   helper <action> <paramsFile> <outFile>
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ops = require('../src/core/esp-ops');

function main() {
  const args = process.argv.slice(2);
  const [action, paramsFile, outFile] = args;
  if (args.length !== 3 || !['scan', 'show', 'init'].includes(action)
      || !path.isAbsolute(paramsFile) || !path.isAbsolute(outFile)
      || path.dirname(paramsFile) !== path.dirname(outFile)
      || path.basename(paramsFile) !== 'params.json' || path.basename(outFile) !== 'out.json') {
    process.stderr.write('Invalid privileged helper arguments');
    process.exit(2);
  }
  let result;
  let code = 0;
  let input;
  try {
    input = fs.lstatSync(paramsFile);
    if (!input.isFile() || input.isSymbolicLink()) throw new Error('Invalid parameter file');
    const params = JSON.parse(fs.readFileSync(paramsFile, 'utf8'));
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new Error('Invalid helper parameters');
    }
    result = ops[action](params);
  } catch (error) {
    result = { error: String((error && error.message) || error) };
    code = 1;
  }
  try {
    fs.writeFileSync(outFile, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
    if (input && process.platform !== 'win32' && process.getuid && process.getuid() === 0) {
      fs.chownSync(outFile, input.uid, input.gid);
    }
  } catch (error) {
    process.stderr.write(`Could not return helper result: ${error.message}`);
    code = 1;
  }
  process.exit(code);
}

main();
