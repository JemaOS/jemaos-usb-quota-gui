'use strict';

const path = require('node:path');

const shquote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
const psquote = value => `'${String(value).replace(/'/g, "''")}'`;
const encodePowerShell = script => Buffer.from(script, 'utf16le').toString('base64');

function commandFor({ platform, executable, helper, action, paramsFile, outFile, electron, systemRoot }) {
  if (!['scan', 'show', 'init'].includes(action)) {
    throw new Error('Unsupported privileged action');
  }
  const args = [helper, action, paramsFile, outFile];
  if (platform === 'linux') {
    return {
      file: '/usr/bin/pkexec',
      args: electron
        ? ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', executable, ...args]
        : [executable, ...args],
    };
  }
  if (platform === 'darwin') {
    const parts = electron
      ? ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', executable, ...args]
      : [executable, ...args];
    const command = parts.map(shquote).join(' ');
    return {
      file: '/usr/bin/osascript',
      args: ['-e', `do shell script "${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`],
    };
  }
  if (platform === 'win32') {
    const powershell = path.win32.join(systemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const inner = [
      "$ErrorActionPreference = 'Stop'",
      electron ? "$env:ELECTRON_RUN_AS_NODE = '1'" : '',
      `& ${[executable, ...args].map(psquote).join(' ')}`,
      'exit $LASTEXITCODE',
    ].filter(Boolean).join('\n');
    // EncodedCommand removes the cmd.exe layer and its %/! expansion.
    const argumentsText = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodePowerShell(inner)}`;
    const outer = [
      "$ErrorActionPreference = 'Stop'",
      `$child = Start-Process -FilePath ${psquote(powershell)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop -ArgumentList ${psquote(argumentsText)}`,
      'exit $child.ExitCode',
    ].join('\n');
    return { file: powershell, args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(outer)] };
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

// Ordered list of elevation commands to try. On Linux we try pkexec first and
// fall back to `sudo -n` (non-interactive): the ChromeOS Linux container
// (Crostini) has no polkit authentication agent, so pkexec always fails there,
// while its user has passwordless sudo.
function elevationCandidates(options) {
  const primary = commandFor(options);
  if (options.platform !== 'linux') {
    return [primary];
  }
  const args = [options.helper, options.action, options.paramsFile, options.outFile];
  const inner = options.electron
    ? ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', options.executable, ...args]
    : [options.executable, ...args];
  return [
    primary,
    { file: '/usr/bin/sudo', args: ['-n', ...inner] },
  ];
}

module.exports = { commandFor, elevationCandidates };
