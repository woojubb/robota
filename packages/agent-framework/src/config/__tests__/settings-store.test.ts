import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createNodeHostSettingsStore,
  createWorkspaceProjectSettingsStore,
} from '../settings-store.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import {
  WorkspaceAuthorityRequiredError,
  createWorkspaceProjectSettingsWriter,
} from '../../workspace-trust/index.js';

const roots: string[] = [];

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-settings-store-')));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('settings stores', () => {
  it('keeps an explicit Node host store distinct from project authority', () => {
    const store = createNodeHostSettingsStore('user', join(tempRoot(), 'settings.json'));

    store.write({ user: true });

    expect(store.kind).toBe('host');
    expect(store.read()).toEqual({ user: true });
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'reads and writes only the project target approved by the same authority',
    async () => {
      const root = tempRoot();
      const access = await createTrustedProjectAccessFixture(root);
      if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
      const writer = createWorkspaceProjectSettingsWriter(access.authority, {
        status: 'approved',
        target: 'project-local',
        purpose: 'test settings store',
      });
      const store = createWorkspaceProjectSettingsStore(access.authority, writer);

      store.write({ project: true });

      expect(store.kind).toBe('project');
      expect(store.scope).toBe('project-local');
      expect(store.read()).toEqual({ project: true });
    },
  );

  it('rejects a settings writer minted for a different workspace authority', async () => {
    const left = await createTrustedProjectAccessFixture(tempRoot());
    const right = await createTrustedProjectAccessFixture(tempRoot());
    if (left.status !== 'trusted' || right.status !== 'trusted') {
      throw new Error('Expected trusted project access.');
    }
    const writer = createWorkspaceProjectSettingsWriter(left.authority, {
      status: 'approved',
      target: 'project',
      purpose: 'test cross-workspace denial',
    });

    expect(() => createWorkspaceProjectSettingsStore(right.authority, writer)).toThrowError(
      WorkspaceAuthorityRequiredError,
    );
  });
});
