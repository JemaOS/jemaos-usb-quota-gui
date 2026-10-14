'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { commandFor } = require('../src/core/elevation');
const root = path.join(__dirname, '..');

function load(relative, dependencies, globals = {}) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name),
    process, Buffer, console, ...globals,
  }, { filename });
  return module.exports;
}

const options = {
  executable: '/app/Quota JemaOS/bin', helper: '/app/Quota JemaOS/priv.js',
  action: 'init', paramsFile: '/tmp/request/params.json', outFile: '/tmp/request/out.json',
};

for (const electron of [false, true]) {
  test(`Linux elevation includes the helper and preserves argv (Electron=${electron})`, () => {
    const command = commandFor({ ...options, platform: 'linux', electron });
    assert.equal(command.file, '/usr/bin/pkexec');
    assert.deepEqual(command.args, [
      ...(electron ? ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1'] : []),
      options.executable, options.helper, options.action, options.paramsFile, options.outFile,
    ]);
  });

  test(`Windows elevation encodes paths instead of interpreting them with cmd (Electron=${electron})`, () => {
    const inputs = {
      ...options, platform: 'win32', electron, systemRoot: 'C:\\Windows',
      executable: "C:\\Program Files\\Quota's %TEMP%! & app\\app.exe",
      helper: "C:\\Program Files\\Quota's app\\priv.js",
      paramsFile: "C:\\Temp\\accent é %TEMP%!\\params.json",
      outFile: "C:\\Temp\\accent é %TEMP%!\\out.json",
    };
    const command = commandFor(inputs);
    const outer = Buffer.from(command.args.at(-1), 'base64').toString('utf16le');
    assert.match(outer, /-Verb RunAs -Wait -PassThru/);
    assert.match(outer, /exit \$child\.ExitCode/);
    assert.doesNotMatch(outer, /cmd\.exe/i);
    const encoded = outer.match(/EncodedCommand ([A-Za-z0-9+/=]+)/)[1];
    const inner = Buffer.from(encoded, 'base64').toString('utf16le');
    for (const value of [inputs.executable, inputs.helper, inputs.action, inputs.paramsFile, inputs.outFile]) {
      assert.ok(inner.includes(`'${value.replace(/'/g, "''")}'`));
    }
    assert.equal(inner.includes("$env:ELECTRON_RUN_AS_NODE = '1'"), electron);
    assert.match(inner, /exit \$LASTEXITCODE/);
  });
}

test('macOS quoting preserves paths containing spaces, quotes and shell metacharacters', {
  skip: process.platform === 'win32',
}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-quote-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const helper = path.join(dir, "helper 'double\" & %.js");
  fs.writeFileSync(helper, 'console.log(JSON.stringify(process.argv.slice(2)));');
  const paramsFile = path.join(dir, "spaces 'quotes\" $literal ! & é params.json");
  const outFile = path.join(dir, "out 'quotes\".json");
  const command = commandFor({ platform: 'darwin', executable: process.execPath,
    helper, action: 'show', paramsFile, outFile, electron: false });
  assert.equal(command.file, '/usr/bin/osascript');
  const script = command.args[1];
  const literal = script.slice('do shell script "'.length, -'" with administrator privileges'.length);
  const shell = literal.replace(/\\([\\"])/g, '$1');
  // Only a harmless argv-capture fixture is executed, never an elevated command.
  const result = spawnSync('/bin/sh', ['-c', shell], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['show', paramsFile, outFile]);
});

test('unrecognized privileged actions are rejected before constructing a command', () => {
  assert.throws(() => commandFor({ ...options, platform: 'win32', action: 'resolveKey' }), /Unsupported/);
});

function serviceFixture(config = {}) {
  const files = new Map();
  const calls = { executed: 0, cleaned: false, operations: 0 };
  const fakeFs = {
    mkdtempSync: () => '/fixture/request',
    writeFileSync: (file, value, options) => {
      assert.equal(options.flag, 'wx');
      if (config.writeError) throw new Error('write failure');
      files.set(file, value);
    },
    existsSync: file => files.has(file),
    readFileSync: file => files.get(file),
    rmSync: () => { calls.cleaned = true; },
  };
  const execute = (_file, _args, _options, callback) => {
    calls.executed++;
    if (config.result !== undefined) files.set(path.join('/fixture/request', 'out.json'), config.result);
    callback(config.launchError || null, '', '');
  };
  const exported = load('src/core/service.js', {
    'node:fs': fakeFs,
    'node:child_process': { execFile: execute },
    '../platform': {
      isElevated: () => Boolean(config.elevated),
      listDevices: () => { if (config.scanError) throw config.scanError; return []; },
    },
    './esp-ops': {
      resolveKey: () => '/fixture/key',
      init: () => { calls.operations++; return { valid: true, limit: 100, used: 0 }; },
    },
  }, { process: { platform: config.platform || 'linux', execPath: '/app/node', versions: {}, env: {} } });
  return { service: exported, calls };
}

test('business error from the helper is returned even when the elevation tool exits nonzero', async () => {
  const { service, calls } = serviceFixture({ result: '{"error":"EFI is read-only"}', launchError: new Error('exit 1') });
  await assert.rejects(service.init({ device: '/dev/example', limit: 100 }), /EFI is read-only/);
  assert.equal(calls.cleaned, true);
});

test('a nonzero helper exit can never be announced as a success', async () => {
  const { service } = serviceFixture({ result: '{"valid":true,"limit":100,"used":0}', launchError: new Error('exit 1') });
  await assert.rejects(service.init({ device: '/dev/example', limit: 100 }), /did not complete/);
});

for (const result of ['{broken', 'null', '[]', '{"unexpected":true}']) {
  test(`malformed helper response fails closed: ${result}`, async () => {
    const { service, calls } = serviceFixture({ result });
    await assert.rejects(service.init({ device: '/dev/example', limit: 100 }), /invalid result|unexpected result/);
    assert.equal(calls.cleaned, true);
  });
}

test('preparation failure cleans up without launching an authorization prompt', async () => {
  const { service, calls } = serviceFixture({ writeError: true });
  await assert.rejects(service.init({ device: '/dev/example', limit: 100 }), /write failure/);
  assert.equal(calls.executed, 0);
  assert.equal(calls.cleaned, true);
});

test('already elevated process does not invoke a second elevation tool', async () => {
  const { service, calls } = serviceFixture({ elevated: true });
  assert.equal((await service.init({ device: '/dev/example', limit: 100 })).valid, true);
  assert.equal(calls.executed, 0);
  assert.equal(calls.operations, 1);
});

test('Windows device scan elevates only after a specific permission denial', async () => {
  const denied = Object.assign(new Error('access denied'), { code: 'ADMIN_REQUIRED' });
  const { service, calls } = serviceFixture({ platform: 'win32', scanError: denied, result: '[]' });
  assert.equal((await service.scan()).length, 0);
  assert.equal(calls.executed, 1);
});

test('invalid helper parameters never reach the privileged operations', () => {
  const called = { operations: 0, exit: null, output: null };
  const finished = new Error('exit fixture');
  assert.throws(() => load('bin/jemaos-quota-priv.js', {
    'node:fs': {
      lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false }),
      readFileSync: () => '{invalid',
      writeFileSync: (_file, data, options) => { assert.equal(options.flag, 'wx'); called.output = JSON.parse(data); },
    },
    '../src/core/esp-ops': { init: () => { called.operations++; } },
  }, { process: { platform: 'win32', argv: ['node', 'helper', 'init', '/fixture/params.json', '/fixture/out.json'],
    stderr: { write() {} }, exit: code => { called.exit = code; throw finished; } } }), error => error === finished);
  assert.equal(called.operations, 0);
  assert.equal(called.exit, 1);
  assert.equal(typeof called.output.error, 'string');
});
