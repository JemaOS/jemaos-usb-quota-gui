'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const dist = path.join(root, 'dist');
let executable;

if (process.platform === 'linux') {
  executable = path.join(dist, 'linux-unpacked', pkg.build.executableName);
} else if (process.platform === 'win32') {
  executable = path.join(dist, 'win-unpacked', `${pkg.build.executableName}.exe`);
} else if (process.platform === 'darwin') {
  const directory = path.join(dist, process.arch === 'arm64' ? 'mac-arm64' : 'mac');
  const bundles = fs.readdirSync(directory).filter(name => name.endsWith('.app'));
  if (bundles.length !== 1) throw new Error('Expected exactly one macOS application bundle');
  const bundle = path.join(directory, bundles[0]);
  const name = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-',
    path.join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
  executable = path.join(bundle, 'Contents', 'MacOS', name);
} else {
  throw new Error(`Unsupported platform: ${process.platform}`);
}

if (!fs.existsSync(executable)) throw new Error(`Build the native package first: ${executable}`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(executable, ['--smoke-test'], { encoding: 'utf8', env, timeout: 30000, windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || `Native app exited with code ${result.status}`);
const output = result.stdout.split('\n').find(line => line.startsWith('{"native":true'));
if (!output) throw new Error(`Native bridge did not return a result: ${result.stdout}`);
const info = JSON.parse(output);
if (info.protocol !== 'file:' || info.platform !== process.platform || info.devices !== 0) {
  throw new Error('Native launch validation failed');
}
console.log(`Native package verified without USB operations: ${output}`);
