#!/usr/bin/env node
'use strict';
// CJS wrapper — runs synchronously before any ESM module is loaded.
// Static ESM imports in dist/node/bin.js are hoisted by the JS engine,
// so version/env checks placed there would execute too late.

const REQUIRED_NODE_MAJOR = 22;
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < REQUIRED_NODE_MAJOR) {
  process.stderr.write(
    '\n  Robota requires Node.js ' +
      REQUIRED_NODE_MAJOR +
      ' or higher.\n' +
      '  Current version: ' +
      process.versions.node +
      '\n\n' +
      '  Upgrade options:\n' +
      '    nvm: nvm install ' +
      REQUIRED_NODE_MAJOR +
      ' && nvm use ' +
      REQUIRED_NODE_MAJOR +
      '\n' +
      '    Download: https://nodejs.org/en/download\n\n',
  );
  process.exit(1);
}

if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
  process.stderr.write(
    '\n  ⚠️  Warning: macOS Terminal.app detected.\n' +
      '  CJK input (Korean/Chinese/Japanese) may cause crashes.\n' +
      '  Recommended: use iTerm2 or another terminal emulator.\n\n',
  );
}

// Load ESM main entry only after synchronous checks pass.
// CJS can dynamic-import ESM in Node.js 12+. This is the only way to load
// an ESM module from CJS — eslint-disable is intentional and required.
// eslint-disable-next-line no-restricted-syntax
import(new URL('../dist/node/bin.js', 'file://' + __filename)).catch(function (err) {
  process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
