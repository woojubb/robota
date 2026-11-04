import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContributionSourcesForProjectAccess } from '../initial-contribution-sources.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createRestrictedWorkspaceProjectAccess } from '../../workspace-trust/index.js';

import type { IContributionSource } from '../contribution-source.js';

/**
 * The user's contribution sources are the caller's: the neutral composition adds them to the trusted
 * project's source and never builds a root from a home directory itself.
 */
function hostSource(name: string): IContributionSource {
  return {
    kind: 'host',
    displayName: name,
    readText: () => undefined,
    listDirectory: () => [],
    inspectKind: () => undefined,
    locate: (relativePath: string) => `${name}/${relativePath}`,
  };
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createContributionSourcesForProjectAccess', () => {
  it('returns exactly the sources the caller passed when the project is restricted', () => {
    const access = createRestrictedWorkspaceProjectAccess('untrusted', '/workspace');
    const userSources = [hostSource('user'), hostSource('compat')];

    const sources = createContributionSourcesForProjectAccess(access, userSources);

    expect(sources).toEqual(userSources);
  });

  it('returns nothing for a restricted project with no user sources', () => {
    const access = createRestrictedWorkspaceProjectAccess('untrusted', '/workspace');

    expect(createContributionSourcesForProjectAccess(access, [])).toEqual([]);
  });

  it('puts the trusted project`s own source before the caller`s', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-initial-sources-')));
    roots.push(root);
    const access = await createTrustedProjectAccessFixture(root);
    const user = hostSource('user');

    const sources = createContributionSourcesForProjectAccess(access, [user]);

    expect(sources).toHaveLength(2);
    expect(sources[0]?.kind).toBe('project');
    expect(sources[1]).toBe(user);
  });
});
