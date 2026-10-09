import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OrganizationBroker,
  OrganizationLedger,
  createOrganizationStateActions,
} from '../index.js';
import type { IOrganizationRequest, TOrganizationJson } from '../index.js';
import { fixture, keys, signed } from './fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function setup() {
  let now = Date.now();
  const f = fixture({ now: () => now });
  fixtures.push(f);
  const first = keys();
  const second = keys();
  const grants = [first, second].map((key, index) => ({
    ...f.grant,
    id: `state-${index}`,
    actor: `state-actor-${index}`,
    publicKey: key.publicKey,
    scopes: [
      {
        resource: 'board',
        operations: ['state.read', 'state.lease', 'state.write'],
      },
    ],
  }));
  for (const grant of grants)
    f.ledger.registerGrant(signed('workload', grant, f.issuer.privateKey));
  f.ledger.createStateResource('company', 'task', 'board', { count: 0 });
  const actions = createOrganizationStateActions(f.ledger, {
    resource: 'board',
    readRoles: ['operator'],
    writeRoles: ['operator'],
    writeRequiresApproval: false,
    reservation: { tokens: 0, timeMs: 1000, costMicros: 0 },
  });
  const broker = f.broker(actions);
  function request(
    actor: number,
    operation: string,
    parameters: TOrganizationJson,
  ): IOrganizationRequest {
    const grant = grants[actor]!;
    return f.request({
      grantId: grant.id,
      actor: grant.actor,
      operation: {
        idempotencyKey: randomUUID(),
        resource: 'board',
        operation,
        environment: 'test',
        parameters,
      },
    });
  }
  async function apply(actor: number, operation: string, parameters: TOrganizationJson) {
    const proof = request(actor, operation, parameters);
    return (await broker.apply(f.call(proof, null, [first, second][actor]!.privateKey))).value as {
      revision: number;
      fence: number;
      expiresAt: number;
      value: TOrganizationJson;
    };
  }
  return {
    ...f,
    broker,
    makeBroker: f.broker,
    grants,
    first,
    second,
    request,
    apply,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('signed, durable task state and fencing', () => {
  it('leases, writes and reads a revision through the ordinary authority and budget path', async () => {
    const f = setup();
    expect(await f.apply(0, 'state.read', {})).toEqual({
      revision: 0,
      value: { count: 0 },
    });
    const lease = await f.apply(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    expect(lease.fence).toBe(1);
    expect(
      await f.apply(0, 'state.write', {
        expectedRevision: 0,
        fence: lease.fence,
        value: { count: 1 },
      }),
    ).toEqual({ revision: 1, value: { count: 1 } });
    expect(await f.apply(1, 'state.read', {})).toEqual({
      revision: 1,
      value: { count: 1 },
    });
  });

  it('rejects a concurrent lease, copied actor lease, stale revision and stale fence without overwriting data', async () => {
    const f = setup();
    const lease = await f.apply(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    await expect(f.apply(1, 'state.lease', { expectedRevision: 0, ttlMs: 1000 })).rejects.toThrow();
    await expect(
      f.apply(1, 'state.write', {
        expectedRevision: 0,
        fence: lease.fence,
        value: { stolen: true },
      }),
    ).rejects.toThrow();
    await expect(
      f.apply(0, 'state.write', {
        expectedRevision: 1,
        fence: lease.fence,
        value: { stale: true },
      }),
    ).rejects.toThrow();
    await expect(
      f.apply(0, 'state.write', {
        expectedRevision: 0,
        fence: lease.fence + 1,
        value: { wrongFence: true },
      }),
    ).rejects.toThrow();
    expect(await f.apply(0, 'state.read', {})).toEqual({
      revision: 0,
      value: { count: 0 },
    });
    expect(f.ledger.budgetState('global').active).toBe(0);
    expect(f.ledger.budgetState('global').held.timeMs).toBe(0);
  });

  it('expires the lease and advances its fence for a new actor, denying restored old lease bytes', async () => {
    const f = setup();
    const old = await f.apply(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 100,
    });
    f.advance(101);
    const current = await f.apply(1, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    expect(current.fence).toBe(old.fence + 1);
    await expect(
      f.apply(0, 'state.write', {
        expectedRevision: 0,
        fence: old.fence,
        value: { restored: true },
      }),
    ).rejects.toThrow();
    expect(
      await f.apply(1, 'state.write', {
        expectedRevision: 0,
        fence: current.fence,
        value: { count: 2 },
      }),
    ).toEqual({ revision: 1, value: { count: 2 } });
  });

  it('retains state/fence on real disk reopen and refuses an unauthenticated or unreserved SDK write', async () => {
    const f = setup();
    const lease = await f.apply(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    await f.apply(0, 'state.write', {
      expectedRevision: 0,
      fence: lease.fence,
      value: { count: 3 },
    });
    f.ledger.close();
    const reopened = new OrganizationLedger(f.ledgerOptions);
    const raw = f.request(0, 'state.write', {
      expectedRevision: 1,
      fence: lease.fence,
      value: { count: 99 },
    });
    expect(() => reopened.writeState(f.call(raw, null, f.first.privateKey).request)).toThrow(
      'operation-conflict',
    );
    const broker = new OrganizationBroker({
      ledger: reopened,
      now: f.now,
      actions: createOrganizationStateActions(reopened, {
        resource: 'board',
        readRoles: ['operator'],
        writeRoles: ['operator'],
        writeRequiresApproval: false,
        reservation: { tokens: 0, timeMs: 1000, costMicros: 0 },
      }),
    });
    const read = f.request(0, 'state.read', {});
    expect((await broker.apply(f.call(read, null, f.first.privateKey))).value).toEqual({
      revision: 1,
      value: { count: 3 },
    });
    broker.close();
    reopened.close();
  });

  it('requires the owner-selected approval policy for writes and does not derive it from worker parameters', async () => {
    const f = setup();
    const broker = f.makeBroker(
      createOrganizationStateActions(f.ledger, {
        resource: 'board',
        readRoles: ['operator'],
        writeRoles: ['operator'],
        writeRequiresApproval: true,
        reservation: { tokens: 0, timeMs: 1000, costMicros: 0 },
      }),
    );
    const lease = await f.apply(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    const write = f.request(0, 'state.write', {
      expectedRevision: 0,
      fence: lease.fence,
      value: { count: 4 },
    });
    await expect(broker.apply(f.call(write, null, f.first.privateKey))).rejects.toThrow(
      'approval-required',
    );
    expect(
      (await broker.apply(f.call(write, f.approval(write), f.first.privateKey))).value,
    ).toEqual({ revision: 1, value: { count: 4 } });
  });

  it('does not lose held budgets or permit old lease authority after revocation and policy epoch change', async () => {
    const f = setup();
    const lease = await f.apply(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    f.ledger.revokeGrant(f.grants[0]!.id);
    await expect(
      f.apply(0, 'state.write', {
        expectedRevision: 0,
        fence: lease.fence,
        value: { restored: true },
      }),
    ).rejects.toThrow('revoked');
    f.ledger.advanceEpoch(2);
    await expect(f.apply(1, 'state.read', {})).rejects.toThrow('revoked');
  });

  it('records a state effect atomically, refuses re-dispatch after ack loss and lets only owner reconciliation settle it', async () => {
    const f = setup();
    const lease = await f.apply(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    const write = f.request(0, 'state.write', {
      expectedRevision: 0,
      fence: lease.fence,
      value: { count: 7 },
    });
    const proof = f.call(write, null, f.first.privateKey).request;
    f.ledger.reserve(proof, { tokens: 0, timeMs: 1000, costMicros: 0 }, null, false);
    expect(f.ledger.writeState(proof)).toEqual({
      revision: 1,
      value: { count: 7 },
    });
    // The broker lost its response before settlement; the asset journal still knows the exact result.
    f.ledger.markUnknown(write);
    expect(() => f.ledger.writeState(proof)).toThrow('operation-conflict');
    await expect(
      f.broker.apply(f.call({ ...write, nonce: 'worker-retry' }, null, f.first.privateKey)),
    ).rejects.toThrow('outcome-unknown');
    expect(f.ledger.budgetState('global').held.timeMs).toBe(1000);
    const reconciled = f.ledger.reconcileStateOperation(write);
    expect(reconciled.value).toEqual({ revision: 1, value: { count: 7 } });
    expect(reconciled.usage.timeMs).toBe(1000);
    expect(f.ledger.budgetState('global').held.timeMs).toBe(0);
    expect(f.ledger.reconcileStateOperation(write)).toEqual(reconciled);
    expect(
      (
        await f.broker.apply(
          f.call({ ...write, nonce: 'after-owner-reconciliation' }, null, f.first.privateKey),
        )
      ).value,
    ).toEqual({ revision: 1, value: { count: 7 } });
    expect(await f.apply(0, 'state.read', {})).toEqual({
      revision: 1,
      value: { count: 7 },
    });
  });

  it('does not refund a previously committed state effect as no-effect or reconcile an unproven external effect', async () => {
    const f = setup();
    const lease = f.request(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    const proof = f.call(lease, null, f.first.privateKey).request;
    f.ledger.reserve(proof, { tokens: 0, timeMs: 1000, costMicros: 0 }, null, false);
    f.ledger.leaseState(proof);
    expect(() => f.ledger.leaseState(proof)).toThrow('outcome-unknown');
    expect(() =>
      f.ledger.confirmNoEffect(lease, 'operation-conflict', {
        tokens: 0,
        timeMs: 1,
        costMicros: 0,
      }),
    ).toThrow('outcome-unknown');
    expect(f.ledger.budgetState('global').held.timeMs).toBe(1000);
    const external = f.request(0, 'state.read', {});
    f.ledger.reserve(
      f.call(external, null, f.first.privateKey).request,
      { tokens: 0, timeMs: 1000, costMicros: 0 },
      null,
      false,
    );
    f.ledger.markUnknown(external);
    expect(() => f.ledger.reconcileStateOperation(external)).toThrow('outcome-unknown');
    expect(f.ledger.budgetState('global').held.timeMs).toBe(2000);
  });

  it('reconciles a known past effect after actor revocation without restoring workload authority', async () => {
    const f = setup();
    const lease = f.request(0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 1000,
    });
    const proof = f.call(lease, null, f.first.privateKey).request;
    f.ledger.reserve(proof, { tokens: 0, timeMs: 1000, costMicros: 0 }, null, false);
    f.ledger.leaseState(proof);
    f.ledger.markUnknown(lease);
    f.ledger.revokeGrant(f.grants[0]!.id);
    f.ledger.stopTask('company', 'task');
    f.advance(20_001);
    expect(f.ledger.reconcileStateOperation(lease).value).toMatchObject({
      revision: 0,
      fence: 1,
    });
    expect(f.ledger.budgetState('task', 'company', 'task').held.timeMs).toBe(0);
    await expect(f.apply(0, 'state.read', {})).rejects.toThrow('revoked');
  });

  it('bounds lease TTL to proof authority and refuses cross-task resources or resetting existing state', async () => {
    const f = setup();
    expect(() => f.ledger.createStateResource('company', 'task', 'board', { count: 999 })).toThrow(
      'operation-conflict',
    );
    await expect(f.apply(0, 'state.lease', { expectedRevision: 0, ttlMs: 30_001 })).rejects.toThrow(
      'invalid-schema',
    );
    await expect(
      f.apply(0, 'state.lease', { expectedRevision: 0, ttlMs: 20_001 }),
    ).rejects.toThrow();
    const wrong = { ...f.request(0, 'state.read', {}), task: 'other' };
    await expect(f.broker.apply(f.call(wrong, null, f.first.privateKey))).rejects.toThrow(
      'not-authorized',
    );
  });
});
