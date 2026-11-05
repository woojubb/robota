import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRestrictedWorkspaceProjectAccess, createWorkspaceProjectSettingsSources, getWorkspaceProjectReader } from '@robota-sdk/agent-framework';
import { createNodeWorkspaceTrustService } from '@robota-sdk/agent-framework/node';

import { providerSelectionSettingsPath } from '../command-setup.js';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

import type { IHostSettingsSource } from '@robota-sdk/agent-framework';

function source(path: string | undefined, read: () => string | undefined): IHostSettingsSource {
  return { kind: 'host', scope: 'user', displayName: path ?? 'non-file source', ...(path === undefined ? {} : { path }), read };
}

it('uses the last currentProvider declaration and the known fallback only when none declares it', () => {
  const user = source('/user/settings.json', () => '{"currentProvider":"a"}');
  const compatibility = source('/user/compat.json', () => '{"currentProvider":"b"}');
  const other = source('/user/other.json', () => '{"language":"en"}');
  expect(providerSelectionSettingsPath('/workspace', [user, compatibility, other], user)).toBe('/user/compat.json');
  expect(providerSelectionSettingsPath('/workspace', [other], user)).toBe('/user/settings.json');
});

it('does not guess a file when any source is unreadable, malformed or lacks a file path', () => {
  const user = source('/user/settings.json', () => '{"currentProvider":"a"}');
  const unreadable = source('/user/unreadable.json', () => { throw new Error('unreadable'); });
  const malformed = source('/user/malformed.json', () => '{"currentProvider":');
  const memory = source(undefined, () => '{"currentProvider":"b"}');
  expect(providerSelectionSettingsPath('/workspace', [user, unreadable], user)).toBeUndefined();
  expect(providerSelectionSettingsPath('/workspace', [user, malformed], user)).toBeUndefined();
  expect(providerSelectionSettingsPath('/workspace', [user, memory], user)).toBeUndefined();
});

it('resolves project sources from their trusted worktree root and requires an authority', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'provider-root-')));
  try {
    mkdirSync(join(root, 'nested'));
    execFileSync('git', ['init', '-q', root]);
    writeFileSync(join(root, 'settings.local.json'), '{"currentProvider":"project"}');
    const runtime = createTestProductRuntime('test-product', { HOME: root });
    const trust = createNodeWorkspaceTrustService(join(root, 'trust.json'), runtime.layout.projectStateDirectories);
    const access = await trust.grant(root);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
    const [project] = createWorkspaceProjectSettingsSources(getWorkspaceProjectReader(access.authority), [
      { scope: 'project-local', relativePath: 'settings.local.json' },
    ]);
    if (project === undefined) throw new Error('Expected project source.');
    const user = source('/user/settings.json', () => '{"currentProvider":"user"}');
    const cwd = join(root, 'nested');
    expect(providerSelectionSettingsPath(cwd, [user, project], user, access)).toBe(join(root, 'settings.local.json'));
    expect(providerSelectionSettingsPath(cwd, [user, project], user)).toBeUndefined();
    expect(providerSelectionSettingsPath(cwd, [user, project], user, createRestrictedWorkspaceProjectAccess('untrusted', root))).toBeUndefined();
    const another = await trust.grant(root);
    expect(providerSelectionSettingsPath(cwd, [user, project], user, another)).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
