'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const executable = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [path.join(__dirname, '..'), ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code === null ? 1 : code; });
