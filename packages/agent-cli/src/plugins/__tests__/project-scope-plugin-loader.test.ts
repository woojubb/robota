/**
 * Issue #2487 (PLG-021 residual) — a project-scope install must be visible to the reload path.
 *
 * `installPlugin(..., 'project')` writes under `<cwd>/.robota/plugins`; a trusted reload must read
 * that scope, while a restricted reload must not consume project-controlled plugin content.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CommandRegistry,
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { reloadPluginCommandSource } from '../default-plugin-command-source-loader.js';
import { createTrustedWorkspaceProjectAccess } from '../../__tests__/helpers/trusted-workspace-project-access.js';

import type { IWorkspaceTrustStoreSnapshot } from '@robota-sdk/agent-framework';

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
  it('does not load project plugins from a restricted workspace', () => {
    writePluginBundle(cwd, 'untrusted-project', 'project scope');

    expect(
      reloadPluginCommandSource(
        new CommandRegistry(),
        cwd,
        createRestrictedWorkspaceProjectAccess('untrusted', cwd),
      ),
    ).toBe(0);
  });

  it('a plugin installed under <cwd>/.robota/plugins is loaded when the workspace is trusted', async () => {
    writePluginBundle(cwd, 'project-only', 'project scope');

    expect(
      reloadPluginCommandSource(
        new CommandRegistry(),
        cwd,
        await createTrustedWorkspaceProjectAccess(cwd),
      ),
    ).toBe(1);
  });

  it('does not accept trust granted to another workspace', async () => {
    writePluginBundle(cwd, 'other-project', 'project scope');

    expect(
      reloadPluginCommandSource(
        new CommandRegistry(),
        cwd,
        await createTrustedWorkspaceProjectAccess(home),
      ),
    ).toBe(0);
  });

  it('does not reload project plugins after the same trust authority is revoked', async () => {
    writePluginBundle(cwd, 'revoked-project', 'project scope');
    const identity = { repositoryKey: `test:${cwd}`, displayPath: cwd, worktreeRoot: cwd };
    let snapshot: IWorkspaceTrustStoreSnapshot = {
      state: 'trusted',
      generation: 1,
      grantedAt: '2026-08-22T00:00:00.000Z',
    };
    const service = new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: {
        inspect: async () => snapshot,
        grant: async () => snapshot,
        revoke: async () => {
          snapshot = { state: 'revoked', generation: 2 };
          return snapshot;
        },
      },
    });
    const access = await service.inspect(cwd);
    expect(access.status).toBe('trusted');
    await service.revoke(cwd);

    expect(reloadPluginCommandSource(new CommandRegistry(), cwd, access)).toBe(0);
  });

  it('without cwd only the user scope is read — the former behaviour, now opt-in', () => {
    writePluginBundle(cwd, 'project-only', 'project scope');

    expect(reloadPluginCommandSource(new CommandRegistry())).toBe(0);
  });

  it('a plugin present in both scopes is loaded once, from the project scope when trusted', async () => {
    writePluginBundle(home, 'shared', 'user copy');
    writePluginBundle(cwd, 'shared', 'project copy');
    writePluginBundle(home, 'user-only', 'user scope');

    expect(
      reloadPluginCommandSource(
        new CommandRegistry(),
        cwd,
        await createTrustedWorkspaceProjectAccess(cwd),
      ),
    ).toBe(2);
  });
});
