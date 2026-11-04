import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createProjectPermissionPersistence } from '../project-permission-persistence.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createRestrictedWorkspaceProjectAccess } from '../../workspace-trust/index.js';

const testHost = createTestFrameworkHost();
const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-project-permission-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('project permission persistence', () => {
  it('requires trusted access and a host-selected project-local path', async () => {
    const root = tempRoot();
    const access = await createTrustedProjectAccessFixture(root);
    const paths = [{ scope: 'project-local' as const, relativePath: '.acme/settings.local.json' }];

    expect(createProjectPermissionPersistence(undefined, paths, testHost)).toBeUndefined();
    expect(
      createProjectPermissionPersistence(
        createRestrictedWorkspaceProjectAccess('untrusted', root),
        paths,
        testHost,
      ),
    ).toBeUndefined();
    expect(createProjectPermissionPersistence(access, [], testHost)).toBeUndefined();
    expect(createProjectPermissionPersistence(access, paths, testHost)).toBeTypeOf(
      process.platform === 'linux' ? 'function' : 'undefined',
    );
  });

  it('offers nothing on a host that cannot write project files, or says nothing about it', async () => {
    const root = tempRoot();
    const access = await createTrustedProjectAccessFixture(root);
    const paths = [{ scope: 'project-local' as const, relativePath: '.acme/settings.local.json' }];

    for (const supportsProjectMutation of [false, undefined]) {
      const host = createTestFrameworkHost({ supportsProjectMutation });
      expect(createProjectPermissionPersistence(access, paths, host)).toBeUndefined();
    }
    const capable = createTestFrameworkHost({ supportsProjectMutation: true });
    expect(createProjectPermissionPersistence(access, paths, capable)).toBeTypeOf('function');
  });

  it.runIf(process.platform === 'linux')(
    'merges an approved scope into the host-selected local document only once',
    async () => {
      const root = tempRoot();
      const access = await createTrustedProjectAccessFixture(root);
      const localPath = join(root, '.acme', 'settings.local.json');
      mkdirSync(join(root, '.acme'));
      writeFileSync(
        localPath,
        JSON.stringify({ theme: 'dark', permissions: { deny: ['Bash(rm *)'], allow: ['Read(*)'] } }),
      );
      const persist = createProjectPermissionPersistence(
        access,
        [
          { scope: 'project' as const, relativePath: '.acme/settings.json' },
          { scope: 'project-local' as const, relativePath: '.acme/settings.local.json' },
        ],
        testHost,
      );
      if (persist === undefined) throw new Error('Expected project persistence capability.');

      persist('Bash(git *)');
      persist('Bash(git *)');

      expect(JSON.parse(readFileSync(localPath, 'utf8'))).toEqual({
        theme: 'dark',
        permissions: { deny: ['Bash(rm *)'], allow: ['Read(*)', 'Bash(git *)'] },
      });
      expect(() => readFileSync(join(root, '.agent', 'settings.local.json'))).toThrow();
    },
  );
});
