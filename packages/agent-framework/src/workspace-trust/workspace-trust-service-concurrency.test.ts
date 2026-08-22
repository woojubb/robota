import { describe, expect, it } from 'vitest';

import { WorkspaceTrustService, assertWorkspaceProjectAuthority } from './index.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
} from './index.js';

class ControlledTrustStore implements IWorkspaceTrustStore {
  private state: IWorkspaceTrustStoreSnapshot = {
    state: 'untrusted',
    generation: 0,
  };
  private heldInspection: Promise<void> | undefined;

  holdNextInspection(): () => void {
    let release: (() => void) | undefined;
    this.heldInspection = new Promise((resolve) => {
      release = resolve;
    });
    return () => release?.();
  }

  inspect(): Promise<IWorkspaceTrustStoreSnapshot> {
    const snapshot = this.state;
    const heldInspection = this.heldInspection;
    this.heldInspection = undefined;
    return heldInspection === undefined
      ? Promise.resolve(snapshot)
      : heldInspection.then(() => snapshot);
  }

  grant(
    _identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot> {
    expect(expectedGeneration).toBe(this.state.generation);
    this.state = {
      state: 'trusted',
      generation: this.state.generation + 1,
    };
    return Promise.resolve(this.state);
  }

  revoke(
    _identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot> {
    expect(expectedGeneration).toBe(this.state.generation);
    this.state = {
      state: 'revoked',
      generation: this.state.generation + 1,
    };
    return Promise.resolve(this.state);
  }
}

describe('WorkspaceTrustService concurrent inspection', () => {
  it('does not let a stale trusted inspection reactivate authority after revoke completes', async () => {
    const identity: IWorkspaceIdentity = {
      repositoryKey: 'test:concurrent-inspection',
      displayPath: '/workspace',
      worktreeRoot: '/workspace',
    };
    const store = new ControlledTrustStore();
    const service = new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store,
    });
    const granted = await service.grant(identity.worktreeRoot);
    if (granted.status !== 'trusted') throw new Error('expected trusted access');

    const releaseStaleInspection = store.holdNextInspection();
    const staleInspection = service.inspect(identity.worktreeRoot);
    const revoked = await service.revoke(identity.worktreeRoot);
    releaseStaleInspection();
    const lateResult = await staleInspection;

    expect(revoked).toMatchObject({ status: 'restricted', trustState: 'revoked' });
    expect(lateResult).toMatchObject({ status: 'restricted', trustState: 'stale/replaced' });
    expect(() => assertWorkspaceProjectAuthority(granted.authority)).toThrow(
      'The workspace project authority is no longer active.',
    );
  });
});
