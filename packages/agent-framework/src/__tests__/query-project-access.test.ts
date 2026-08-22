import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createQuery, createRestrictedWorkspaceProjectAccess } from '../index.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';

describe('createQuery project access', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('reports Restricted access when the host supplies no project decision', () => {
    const scripted = createScriptedProvider([]);
    const query = createQuery({ provider: scripted.provider });

    expect(query.projectAccess).toMatchObject({
      status: 'restricted',
      reason: 'WorkspaceAuthorityRequired',
    });
  });

  it('retains an explicit host decision on the returned query function', () => {
    const projectAccess = createRestrictedWorkspaceProjectAccess('revoked', '/workspace');
    const scripted = createScriptedProvider([]);
    const query = createQuery({ provider: scripted.provider, projectAccess });

    expect(query.projectAccess).toBe(projectAccess);
  });

  it('refuses trusted project access minted for a different query root', async () => {
    const trustedRoot = mkdtempSync(join(tmpdir(), 'robota-query-trusted-'));
    const queryRoot = mkdtempSync(join(tmpdir(), 'robota-query-cwd-'));
    roots.push(trustedRoot, queryRoot);
    const projectAccess = await createTrustedProjectAccessFixture(trustedRoot);
    const scripted = createScriptedProvider([]);

    expect(() =>
      createQuery({ cwd: queryRoot, provider: scripted.provider, projectAccess }),
    ).toThrow('Trusted project access does not cover the requested working directory.');
  });
});
