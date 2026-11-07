#!/usr/bin/env node
/** Verify the main-only keyring authority resolves from a packaged app's own archive. */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const archive = process.argv[2];
if (!archive) throw new Error('Pass the packaged app.asar path.');
const fixture = mkdtempSync(join(tmpdir(), 'robota-packaged-keyring-'));
try {
  asar.extractAll(resolve(archive), fixture);
  writeFileSync(join(fixture, 'check-keyring.cjs'), `
    const path = require('node:path');
    const root = __dirname;
    for (const name of ['@robota-sdk/agent-local-host', '@robota-sdk/agent-core/node', '@robota-sdk/agent-keyring']) {
      const resolved = require.resolve(name);
      if (!resolved.startsWith(path.join(root, 'node_modules') + path.sep)) {
        throw new Error('A keyring dependency resolved outside the packaged app.');
      }
    }
    const main = require('./dist/electron/desktop-keyring-store.js');
    const state = path.join(root, 'isolated-state');
    const store = main.createKeyringFileStore({ root: state, path: path.join(state, 'secure', 'keyring.json') });
    if (store.load().status !== 'missing') throw new Error('The isolated keyring was not empty.');
  `);
  const env = { PATH: process.env.PATH ?? '', HOME: fixture, USERPROFILE: fixture };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const result = spawnSync(process.execPath, [join(fixture, 'check-keyring.cjs')], {
    cwd: fixture, env, encoding: 'utf8', timeout: 15_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Packaged keyring resolution failed: ${result.error?.message ?? result.stderr}`);
  }
  console.log('The packaged main resolved its own keyring authority and opened isolated state.');
} finally {
  rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
