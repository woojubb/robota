import { describe, expect, it } from 'vitest';

import { WorkspaceTrustService } from './index.js';

import type { IWorkspaceIdentity, IWorkspaceTrustStore } from './index.js';

const identity: IWorkspaceIdentity = {
  repositoryKey: 'test:cause',
  displayPath: '/workspace',
  worktreeRoot: '/workspace',
};

class BrokenStore implements IWorkspaceTrustStore {
  inspect(): Promise<never> {
    return Promise.reject(new RangeError('trust store is corrupt'));
  }
  grant(): Promise<never> {
    return Promise.reject(new Error('unused'));
  }
  revoke(): Promise<never> {
    return Promise.reject(new Error('unused'));
  }
}

describe('WorkspaceTrustService restricted-access cause (OBSERVABILITY-1991 TC-05)', () => {
  it('names the swallowed identity-resolver error on identity-unavailable', async () => {
    const service = new WorkspaceTrustService({
      identityResolver: {
        resolve: () => {
          throw new TypeError('git rev-parse failed');
        },
      },
      store: new BrokenStore(),
    });
    const access = await service.inspect('/workspace');
    expect(access).toMatchObject({
      status: 'restricted',
      trustState: 'identity-unavailable',
      cause: { name: 'TypeError', message: 'git rev-parse failed' },
    });
  });

  it('names the swallowed store error and keeps the display path on store-unavailable', async () => {
    const service = new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: new BrokenStore(),
    });
    const access = await service.inspect('/workspace');
    expect(access).toMatchObject({
      status: 'restricted',
      trustState: 'store-unavailable',
      displayPath: '/workspace',
      cause: { name: 'RangeError', message: 'trust store is corrupt' },
    });
  });

  it('carries no cause when the state is a plain trust decision', async () => {
    const service = new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: {
        inspect: () => Promise.resolve({ state: 'untrusted', generation: 0 }),
        grant: () => Promise.reject(new Error('unused')),
        revoke: () => Promise.reject(new Error('unused')),
      },
    });
    const access = await service.inspect('/workspace');
    expect(access).toMatchObject({ status: 'restricted', trustState: 'untrusted' });
    expect('cause' in access).toBe(false);
  });
});
