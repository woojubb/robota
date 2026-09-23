/**
 * Issue #2487 (PLG-021 residual) — a project-scope install must be visible to the reload path.
 *
 * `installPlugin(..., 'project')` writes under `<cwd>/.robota/plugins`; the loader used to read
 * only `~/.robota/plugins`, so the install "succeeded" and the session saw nothing.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CommandRegistry } from '@robota-sdk/agent-framework';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { reloadPluginCommandSource } from '../default-plugin-command-source-loader.js';

const MARKET = 'test-market';

let home: string;
let cwd: string;
let originalHome: string | undefined;

function writePluginBundle(root: string, plugin: string, description: string): void {
  const metaDir = join(
    root,
    '.robota',
    'plugins',
    'cache',
    MARKET,
    plugin,
    '1.0.0',
    '.claude-plugin',
  );
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, 'plugin.json'),
    JSON.stringify({ name: plugin, version: '1.0.0', description, features: {} }),
    'utf-8',
  );
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'robota-2487-home-')));
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-2487-cwd-')));
  originalHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of [home, cwd]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe('issue #2487: project-scope plugin installs reach the reload path', () => {
  it('a plugin installed under <cwd>/.robota/plugins is loaded when cwd is given', () => {
    writePluginBundle(cwd, 'project-only', 'project scope');

    expect(reloadPluginCommandSource(new CommandRegistry(), cwd)).toBe(1);
  });

  it('without cwd only the user scope is read — the former behaviour, now opt-in', () => {
    writePluginBundle(cwd, 'project-only', 'project scope');

    expect(reloadPluginCommandSource(new CommandRegistry())).toBe(0);
  });

  it('a plugin present in both scopes is loaded once, from the project scope', () => {
    writePluginBundle(home, 'shared', 'user copy');
    writePluginBundle(cwd, 'shared', 'project copy');
    writePluginBundle(home, 'user-only', 'user scope');

    expect(reloadPluginCommandSource(new CommandRegistry(), cwd)).toBe(2);
  });
});
