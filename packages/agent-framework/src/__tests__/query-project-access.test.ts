import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { createQuery, createRestrictedWorkspaceProjectAccess } from '../index.js';

describe('createQuery project access', () => {
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
});
