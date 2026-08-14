import { describe, expect, it } from 'vitest';

import { runTransportLifecycleConformance } from '../testing/transport-lifecycle-conformance.js';

import type { ITransportAdapter, ITransportLifecycleError } from '../transport-adapter.js';

function lifecycleError(code: ITransportLifecycleError['code']): ITransportLifecycleError {
  return Object.assign(new Error(code), {
    name: 'TransportLifecycleError' as const,
    code,
    transportName: 'fixture',
  });
}

function createService(): ITransportAdapter<{ readonly id: string }> & {
  readonly ready: boolean;
} {
  let attached = false;
  let active = false;
  return {
    name: 'fixture',
    lifecycle: Object.freeze({ kind: 'service' }),
    get ready() {
      return active;
    },
    attach: () => {
      attached = true;
    },
    start: async () => {
      if (!attached) throw lifecycleError('not-attached');
      if (active) throw lifecycleError('already-started');
      active = true;
    },
    stop: async () => {
      active = false;
      attached = false;
    },
  };
}

describe('runTransportLifecycleConformance', () => {
  it('accepts the documented attach/start/stop/restart state machine', async () => {
    await expect(
      runTransportLifecycleConformance({
        subjectId: 'fixture#service',
        kind: 'service',
        createAdapter: createService,
        createSession: () => ({ id: 'session' }),
        assertReady: (adapter) => {
          if (!adapter.ready) throw new Error('not ready');
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a mutable lifecycle descriptor', async () => {
    await expect(
      runTransportLifecycleConformance({
        subjectId: 'fixture#mutable',
        kind: 'service',
        createAdapter: () => ({ ...createService(), lifecycle: { kind: 'service' } }),
        createSession: () => ({ id: 'session' }),
        assertReady: () => {},
      }),
    ).rejects.toThrow(/must be frozen/);
  });
});
