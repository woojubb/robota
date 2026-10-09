import { chmodSync, renameSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrganizationBroker, OrganizationLedger } from '../index.js';
import type { IOrganizationAction, IOrganizationGrant, IOrganizationRequest } from '../index.js';
import { fixture, keys, signed } from './fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup(options: Parameters<typeof fixture>[0] = {}) {
  const result = fixture(options);
  fixtures.push(result);
  return result;
}
afterEach(() => {
  for (const item of fixtures.splice(0)) item.cleanup();
});

describe('operator-owned organization authority', () => {
  it('executes a signed operation and returns its durable receipt on a fresh proof without repeating its effect', async () => {
    const f = setup();
    const execute = vi.fn(async () => ({
      value: 'done',
      usage: { tokens: 2, timeMs: 0, costMicros: 2 },
    }));
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
    const completed = await broker.apply(f.call(request));
    await expect(broker.apply(f.call(request))).rejects.toThrow('replayed');
    expect(await broker.apply(f.call({ ...request, nonce: 'fresh-proof' }))).toEqual(completed);
    expect(execute).toHaveBeenCalledTimes(1);
    for (const [kind, identity] of [
      ['global', []],
      ['tenant', ['company']],
      ['task', ['company', 'task']],
      ['grant', ['root']],
    ] as const) {
      const state = f.ledger.budgetState(kind, ...identity);
      expect(state.spent.tokens).toBe(2);
      expect(state.spent.timeMs).toBeGreaterThanOrEqual(1);
      expect(state.held).toEqual({ tokens: 0, timeMs: 0, costMicros: 0 });
      expect(state.active).toBe(0);
    }
  });

  it.each(['tenant', 'task', 'actor', 'audience', 'epoch'] as const)(
    'denies signed cross-boundary %s before an action port is entered',
    async (field) => {
      const f = setup();
      const execute = vi.fn();
      const broker = f.broker([
        {
          resource: 'asset',
          operation: 'read',
          roles: ['operator'],
          requiresApproval: false,
          reserve: () => ({ tokens: 1, timeMs: 100, costMicros: 1 }),
          execute,
        },
      ]);
      const request = f.request({ [field]: field === 'epoch' ? 2 : 'other' });
      await expect(broker.apply(f.call(request))).rejects.toThrow('not-authorized');
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('denies wrong worker keys, mutated proofs, extra fields, expired or excessively long proof TTLs', async () => {
    const f = setup();
    const broker = f.broker();
    const request = f.request();
    await expect(broker.apply(f.call(request, null, keys().privateKey))).rejects.toThrow(
      'invalid-proof',
    );
    const original = f.call(request);
    const tampered = {
      ...original,
      request: {
        ...original.request,
        claims: { ...request, operation: { ...request.operation, parameters: { changed: true } } },
      },
    };
    await expect(broker.apply(tampered)).rejects.toThrow('invalid-proof');
    await expect(broker.apply({ ...f.call(request), admin: true } as never)).rejects.toThrow(
      'invalid-schema',
    );
    for (const times of [
      { notBefore: f.now() - 500, expiresAt: f.now() - 1 },
      { notBefore: f.now(), expiresAt: f.now() + 30_001 },
      { notBefore: f.grant.notBefore - 1, expiresAt: f.now() + 1000 },
    ]) {
      await expect(broker.apply(f.call(f.request(times)))).rejects.toThrow('expired');
    }
    expect(f.ledger.budgetState('global').spent.tokens).toBe(0);
  });

  it('denies missing resources, operations and trusted role mismatch', async () => {
    const f = setup();
    const request = f.request();
    const broker = f.broker();
    for (const operation of [
      { ...request.operation, resource: 'other' },
      { ...request.operation, operation: 'delete' },
    ]) {
      await expect(broker.apply(f.call(f.request({ operation })))).rejects.toThrow(
        'not-authorized',
      );
    }
    const roleBroker = f.broker([
      {
        resource: 'asset',
        operation: 'read',
        roles: ['administrator'],
        requiresApproval: false,
        reserve: () => ({ tokens: 1, timeMs: 100, costMicros: 1 }),
        execute: vi.fn(),
      },
    ]);
    await expect(roleBroker.apply(f.call(request))).rejects.toThrow('not-authorized');
  });

  it('intersects delegated tenant/task/role/TTL/resources/budgets and rechecks every ancestor', async () => {
    const f = setup();
    const childKey = keys();
    const child: IOrganizationGrant = {
      ...f.grant,
      id: 'child',
      parent: f.grant.id,
      actor: 'child-actor',
      publicKey: childKey.publicKey,
      scopes: [{ resource: 'asset', operations: ['read'] }],
      budget: { ...f.limit, tokens: 20, concurrency: 1 },
    };
    const invalid: Partial<IOrganizationGrant>[] = [
      { tenant: 'other' },
      { task: 'other' },
      { role: 'administrator' },
      { expiresAt: f.grant.expiresAt + 1 },
      { notBefore: f.grant.notBefore - 1 },
      { scopes: [{ resource: 'asset', operations: ['delete'] }] },
      { scopes: [{ resource: 'other', operations: ['read'] }] },
      { budget: { ...f.limit, tokens: f.limit.tokens + 1 } },
    ];
    for (const override of invalid)
      expect(() =>
        f.ledger.registerGrant(signed('workload', { ...child, ...override }, f.issuer.privateKey)),
      ).toThrow();
    f.ledger.registerGrant(signed('workload', child, f.issuer.privateKey));
    const request = f.request({ grantId: child.id, actor: child.actor });
    const broker = f.broker();
    await broker.apply(f.call(request, null, childKey.privateKey));
    expect(f.ledger.budgetState('grant', 'root').spent.tokens).toBe(2);
    expect(f.ledger.budgetState('grant', 'child').spent.tokens).toBe(2);
    f.ledger.revokeGrant('root');
    await expect(
      broker.apply(
        f.call(f.request({ grantId: child.id, actor: child.actor }), null, childKey.privateKey),
      ),
    ).rejects.toThrow('revoked');
  });

  it('requires a separate exact operator signature and consumes approval only with successful reservation', async () => {
    const f = setup();
    const execute = vi.fn(async () => ({
      value: 'deployed',
      usage: { tokens: 1, timeMs: 0, costMicros: 1 },
    }));
    const broker = f.broker([
      {
        resource: 'asset',
        operation: 'deploy',
        roles: ['operator'],
        requiresApproval: true,
        reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
        execute,
      },
    ]);
    const request = f.request();
    const deployment = { ...request, operation: { ...request.operation, operation: 'deploy' } };
    await expect(broker.apply(f.call(deployment))).rejects.toThrow('approval-required');
    const approval = f.approval(deployment);
    await expect(
      broker.apply(f.call(deployment, signed('approval', approval.claims, f.issuer.privateKey))),
    ).rejects.toThrow('approval-invalid');
    await expect(
      broker.apply(
        f.call(
          { ...deployment, operation: { ...deployment.operation, parameters: { amount: 2 } } },
          approval,
        ),
      ),
    ).rejects.toThrow('approval-invalid');
    for (const override of [{ actor: 'other' }, { epoch: 2 }, { environment: 'production' }]) {
      await expect(
        broker.apply(f.call(deployment, f.approval(deployment, override))),
      ).rejects.toThrow('approval-invalid');
    }
    await broker.apply(f.call(deployment, approval));
    const other = f.request({
      operation: { ...deployment.operation, idempotencyKey: 'second-deploy' },
    });
    await expect(
      broker.apply(f.call(other, f.approval(other, { id: approval.claims.id }))),
    ).rejects.toThrow('approval-reused');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps rejected reservations atomic, including the approval and nonce', () => {
    const f = setup({ budget: { tokens: 5 } });
    const request = f.request();
    const approval = f.approval(request);
    expect(() =>
      f.ledger.reserve(
        f.call(request).request,
        { tokens: 6, timeMs: 10, costMicros: 1 },
        approval,
        true,
      ),
    ).toThrow('budget-exhausted');
    expect(f.ledger.budgetState('global').held.tokens).toBe(0);
    expect(
      f.ledger.reserve(
        f.call(request).request,
        { tokens: 5, timeMs: 10, costMicros: 1 },
        approval,
        true,
      ).kind,
    ).toBe('reserved');
    expect(f.ledger.budgetState('global').held.tokens).toBe(5);
  });

  it.each(['parent', 'task', 'tenant', 'global', 'epoch', 'outage', 'caller', 'broker'] as const)(
    'signals an outstanding action on %s revocation and retains every unknown hold',
    async (kind) => {
      const f = setup();
      let enter!: (signal: AbortSignal) => void;
      const entered = new Promise<AbortSignal>((resolve) => {
        enter = resolve;
      });
      const broker = f.broker([
        {
          resource: 'asset',
          operation: 'read',
          roles: ['operator'],
          requiresApproval: false,
          reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
          execute: async (_, context) => {
            enter(context.signal);
            return new Promise(() => {});
          },
        },
      ]);
      const request = f.request();
      const controller = new AbortController();
      const pending = broker.apply(f.call(request), controller.signal);
      const rejection = expect(pending).rejects.toThrow('outcome-unknown');
      const effectSignal = await entered;
      if (kind === 'parent') f.ledger.revokeGrant('root');
      if (kind === 'task') f.ledger.stopTask('company', 'task');
      if (kind === 'tenant') f.ledger.stopTenant('company');
      if (kind === 'global') f.ledger.emergencyStop();
      if (kind === 'epoch') f.ledger.advanceEpoch(2);
      if (kind === 'outage') f.ledger.close();
      if (kind === 'caller') controller.abort();
      if (kind === 'broker') broker.close();
      await rejection;
      expect(effectSignal.aborted).toBe(true);
      if (kind === 'outage') {
        const reopened = new OrganizationLedger(f.ledgerOptions);
        expect(reopened.budgetState('global').held.tokens).toBe(10);
        reopened.close();
      } else if (
        kind === 'caller' ||
        kind === 'broker' ||
        kind === 'parent' ||
        kind === 'task' ||
        kind === 'tenant' ||
        kind === 'epoch'
      ) {
        expect(f.ledger.budgetState('global').held.tokens).toBe(10);
      }
    },
  );

  it('refuses blind retry after a timed-out, throwing or over-budget effect, including after disk reopen', async () => {
    for (const mode of ['timeout', 'throw', 'usage'] as const) {
      const f = setup();
      const execute = vi.fn(async () => {
        if (mode === 'timeout') return new Promise<never>(() => {});
        if (mode === 'throw') throw new Error('sensitive provider response');
        return { value: 'side-effect', usage: { tokens: 11, timeMs: 0, costMicros: 1 } };
      });
      const broker = f.broker([
        {
          resource: 'asset',
          operation: 'read',
          roles: ['operator'],
          requiresApproval: false,
          reserve: () => ({ tokens: 10, timeMs: 20, costMicros: 10 }),
          execute,
        },
      ]);
      const request = f.request();
      await expect(broker.apply(f.call(request))).rejects.toThrow('outcome-unknown');
      expect(f.ledger.budgetState('global').active).toBe(1);
      f.ledger.close();
      const reopened = new OrganizationLedger(f.ledgerOptions);
      expect(() =>
        reopened.reserve(
          f.call({ ...request, nonce: 'fresh' }).request,
          { tokens: 1, timeMs: 10, costMicros: 1 },
          null,
          false,
        ),
      ).toThrow('outcome-unknown');
      expect(reopened.budgetState('global').held.tokens).toBe(10);
      reopened.close();
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it('snapshots nested arguments before the action port and refuses mutation of approved parameters', async () => {
    const f = setup();
    const parameters = { nested: { amount: 1 } };
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const broker = f.broker([
      {
        resource: 'asset',
        operation: 'read',
        roles: ['operator'],
        requiresApproval: false,
        reserve: (operation) => {
          expect(() => {
            (operation.parameters as typeof parameters).nested.amount = 4;
          }).toThrow();
          return { tokens: 1, timeMs: 1000, costMicros: 1 };
        },
        execute: async (operation) => {
          enter();
          await waiting;
          return { value: operation.parameters, usage: { tokens: 1, timeMs: 0, costMicros: 1 } };
        },
      },
    ]);
    const request = f.request({ operation: { ...f.request().operation, parameters } });
    const pending = broker.apply(f.call(request));
    await entered;
    parameters.nested.amount = 99;
    finish();
    expect((await pending).value).toEqual({ nested: { amount: 1 } });
  });

  it('does not recreate missing, corrupt, world-readable, replaced or closed policy as empty authority', async () => {
    const f = setup();
    expect(() => new OrganizationLedger({ ...f.ledgerOptions, path: `${f.path}.missing` })).toThrow(
      'policy-unavailable',
    );
    const broker = f.broker();
    chmodSync(f.path, 0o644);
    await expect(broker.apply(f.call(f.request()))).rejects.toThrow('policy-unavailable');
    chmodSync(f.path, 0o600);
    renameSync(f.path, `${f.path}.old`);
    writeFileSync(f.path, 'not a database', { mode: 0o600 });
    await expect(broker.apply(f.call(f.request()))).rejects.toThrow('policy-unavailable');
    expect(() => new OrganizationLedger(f.ledgerOptions)).toThrow('policy-unavailable');
    f.ledger.close();
    await expect(broker.apply(f.call(f.request()))).rejects.toThrow('policy-unavailable');
  });

  it('rejects bootstrap reset, identical issuer/approval keys and duplicated action definitions', () => {
    const f = setup();
    expect(() => new OrganizationLedger({ ...f.ledgerOptions, create: true })).toThrow(
      'policy-unavailable',
    );
    expect(
      () => new OrganizationLedger({ ...f.ledgerOptions, approvalPublicKey: f.issuer.publicKey }),
    ).toThrow('invalid-schema');
    expect(() => f.ledger.createGlobalBudget(f.limit)).toThrow('operation-conflict');
    const action: IOrganizationAction = {
      resource: 'asset',
      operation: 'read',
      roles: ['operator'],
      requiresApproval: false,
      reserve: () => ({ tokens: 1, timeMs: 100, costMicros: 1 }),
      execute: vi.fn(),
    };
    expect(() => new OrganizationBroker({ ledger: f.ledger, actions: [action, action] })).toThrow(
      'invalid-schema',
    );
  });
});
