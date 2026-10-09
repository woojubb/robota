import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrganizationNoEffect } from '../index.js';
import { fixture } from './fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() {
  const f = fixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe('trusted no-effect evidence', () => {
  it('charges trusted usage, releases a confirmed rollback once and returns the same refusal without executing on a fresh proof', async () => {
    const f = setup();
    const execute = vi.fn(async () => {
      throw new OrganizationNoEffect('operation-conflict', {
        tokens: 3,
        timeMs: 0,
        costMicros: 4,
      });
    });
    const broker = f.broker([
      {
        resource: 'asset',
        operation: 'read',
        roles: ['operator'],
        requiresApproval: false,
        reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
        execute,
      },
    ]);
    const request = f.request();
    await expect(broker.apply(f.call(request))).rejects.toThrow('operation-conflict');
    const state = f.ledger.budgetState('global');
    expect(state.held).toEqual({ tokens: 0, timeMs: 0, costMicros: 0 });
    expect(state.active).toBe(0);
    expect(state.spent.tokens).toBe(3);
    expect(state.spent.costMicros).toBe(4);
    expect(state.spent.timeMs).toBeGreaterThanOrEqual(1);
    await expect(broker.apply(f.call({ ...request, nonce: 'fresh-proof' }))).rejects.toThrow(
      'operation-conflict',
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.ledger.budgetState('global')).toEqual(state);
    expect(() =>
      f.ledger.confirmNoEffect(request, 'operation-conflict', {
        tokens: 0,
        timeMs: 0,
        costMicros: 0,
      }),
    ).toThrow('operation-conflict');
  });

  it('does not treat worker JSON or ordinary provider errors as rollback evidence', async () => {
    const f = setup();
    const broker = f.broker([
      {
        resource: 'asset',
        operation: 'read',
        roles: ['operator'],
        requiresApproval: false,
        reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
        execute: async () => {
          throw new Error('unverified provider result');
        },
      },
    ]);
    const request = f.request({
      operation: {
        ...f.request().operation,
        parameters: {
          name: 'OrganizationNoEffect',
          usage: { tokens: 0, timeMs: 0, costMicros: 0 },
          refunded: true,
        },
      },
    });
    await expect(broker.apply(f.call(request))).rejects.toThrow('outcome-unknown');
    expect(f.ledger.budgetState('global').held.tokens).toBe(10);
    expect(
      () =>
        new OrganizationNoEffect('raw-secret-canary' as never, {
          tokens: 0,
          timeMs: 0,
          costMicros: 0,
        }),
    ).toThrow('invalid-schema');
  });

  it('retains the hold when evidence exceeds the reservation or arrives after timeout', async () => {
    for (const mode of ['usage', 'late'] as const) {
      const f = setup();
      const broker = f.broker([
        {
          resource: 'asset',
          operation: 'read',
          roles: ['operator'],
          requiresApproval: false,
          reserve: () => ({ tokens: 10, timeMs: 20, costMicros: 10 }),
          execute: async () => {
            if (mode === 'late') await new Promise((resolve) => setTimeout(resolve, 40));
            throw new OrganizationNoEffect('operation-conflict', {
              tokens: mode === 'usage' ? 11 : 0,
              timeMs: 0,
              costMicros: 0,
            });
          },
        },
      ]);
      await expect(broker.apply(f.call(f.request()))).rejects.toThrow('outcome-unknown');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(f.ledger.budgetState('global').held.tokens).toBe(10);
      expect(f.ledger.budgetState('global').active).toBe(1);
    }
  });

  it('allows owner accounting inspection after stopping a task while denying new workload admission', async () => {
    const f = setup();
    f.ledger.reserve(
      f.call(f.request()).request,
      { tokens: 10, timeMs: 100, costMicros: 10 },
      null,
      false,
    );
    f.ledger.stopTask('company', 'task');
    const state = f.ledger.budgetState('task', 'company', 'task');
    expect(state.stopped).toBe(true);
    expect(state.held.tokens).toBe(10);
    await expect(f.broker().apply(f.call(f.request()))).rejects.toThrow('revoked');
  });
});
