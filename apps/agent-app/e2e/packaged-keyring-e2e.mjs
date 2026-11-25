#!/usr/bin/env node
/**
 * Verify the main-only keyring authority resolves from a packaged app's own archive, and that the
 * archive's copy of the local host package loads as the ES module the desktop's owner flow imports.
 */
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
  writeFileSync(join(fixture, 'check-owner-entry.mjs'), `
    const resolved = import.meta.resolve('@robota-sdk/agent-local-host');
    if (!resolved.startsWith(new URL('./node_modules/', import.meta.url).href)) {
      throw new Error('The local host package resolved outside the packaged app.');
    }
    const host = await import('@robota-sdk/agent-local-host');
    if (typeof host.openNativeSecureOwner !== 'function') {
      throw new Error('The packaged local host package does not export openNativeSecureOwner.');
    }
  `);
  const env = { PATH: process.env.PATH ?? '', HOME: fixture, USERPROFILE: fixture };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const run = (script, failure) => {
    const result = spawnSync(process.execPath, [join(fixture, script)], {
      cwd: fixture, env, encoding: 'utf8', timeout: 15_000,
    });
    if (result.error || result.status !== 0) throw new Error(`${failure}: ${result.error?.message ?? result.stderr}`);
  };
  run('check-keyring.cjs', 'Packaged keyring resolution failed');
  console.log('The packaged main resolved its own keyring authority and opened isolated state.');
  run('check-owner-entry.mjs', 'Packaged owner flow entry failed');
  console.log('The packaged local host package loaded as an ES module and exports the native owner flow.');
} finally {
  rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
