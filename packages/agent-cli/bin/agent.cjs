#!/usr/bin/env node
'use strict';
// CJS wrapper — runs synchronously before any ESM module is loaded.
// Static ESM imports in dist/node/bin.js are hoisted by the JS engine,
// so version/env checks placed there would execute too late.

const REQUIRED_NODE_MAJOR = 22;
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < REQUIRED_NODE_MAJOR) {
  process.stderr.write(
    '\n  This CLI requires Node.js ' +
      REQUIRED_NODE_MAJOR +
      ' or higher.\n' +
      '  Current version: ' +
      process.versions.node +
      '\n' +
      '  (Reason: the TUI renderer ink 7.x requires Node.js 22+)\n\n' +
      '  Upgrade options:\n' +
      '    nvm: nvm install ' +
      REQUIRED_NODE_MAJOR +
      ' && nvm use ' +
      REQUIRED_NODE_MAJOR +
      '\n' +
      '    Volta: volta install node@' +
      REQUIRED_NODE_MAJOR +
      '\n' +
      '    Download: https://nodejs.org/en/download\n\n',
  );
  process.exit(1);
}

// Keep a program of the same user from reading this process (see src/process-hardening.ts, which
// the bundle's entry applies again for the entries that do not start here). It is done here, before
// the ESM import, because loading the module graph below takes about a second during which both
// doors would stay open. Best effort: it must never block startup.
// Node opens its inspector on SIGUSR1 unless a listener holds the signal; the listener stays for the
// life of the process. Bun's SIGUSR1 opens no Node inspector, and Windows has no SIGUSR1.
if (process.versions.bun === undefined && process.platform !== 'win32') {
  process.on('SIGUSR1', function holdInspectorSignal() {});
}
// Linux: make this process undumpable so its environment and memory cannot be read.
if (process.platform === 'linux') {
  try {
    // Synchronous on purpose: this runs before the ESM graph, so it cannot import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('koffi')
      .load('libc.so.6')
      .func(
        'int prctl(int option, unsigned long arg2, unsigned long arg3, unsigned long arg4, unsigned long arg5)',
      )(4, 0, 0, 0, 0);
  } catch (err) {
    // Hardening is defence in depth; koffi or the C library failing to load changes nothing else.
  }
}

// Load ESM main entry only after synchronous checks pass.
// CJS can dynamic-import ESM in Node.js 12+. This is the only way to load
// an ESM module from CJS — eslint-disable is intentional and required.
// eslint-disable-next-line no-restricted-syntax
import(new URL('../dist/node/bin.js', 'file://' + __filename)).catch(function (err) {
  process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
