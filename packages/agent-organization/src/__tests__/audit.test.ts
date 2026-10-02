import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OrganizationAudit,
  organizationAuditEvent,
  organizationAuditHash,
  verifyOrganizationAudit,
} from '../audit.js';
import { OrganizationBroker } from '../index.js';
import type { IOrganizationAuditEntry } from '../audit.js';
import { fixture, keys } from './fixtures.js';
import { auditFixture } from './audit-fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
const brokers: OrganizationBroker[] = [];
function setup() {
  const f = fixture();
  fixtures.push(f);
  const a = auditFixture();
  const options = {
    stream: a.stream,
    publicKey: a.signer.publicKey,
    sink: a.sink,
    anchor: a.anchor,
    timeoutMs: 100,
  };
  return { f, a, options, audit: new OrganizationAudit(options) };
}
afterEach(() => {
  for (const b of brokers.splice(0)) b.close();
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe('independently anchored organization audit', () => {
  it('persists only bounded metadata and verifies its history against an independent signed checkpoint', async () => {
    const { f, a, audit } = setup();
    const canary = 'SECRET_CANARY_AUDIT_REQUEST';
    const request = f.request({
      actor: canary,
      operation: { ...f.request().operation, parameters: { password: canary } },
    });
    await audit.record(organizationAuditEvent(request, 'dispatch'));
    await audit.record(organizationAuditEvent(request, 'complete'));
    expect(a.anchored.claims.sequence).toBe(2);
    expect(JSON.stringify({ entries: a.entries, checkpoint: a.anchored })).not.toContain(canary);
    expect(Object.keys(a.entries[0]!.event).sort()).toEqual([
      'actorDigest',
      'epoch',
      'grantDigest',
      'operationDigest',
      'phase',
      'taskDigest',
      'tenantDigest',
    ]);
    expect(
      verifyOrganizationAudit(a.entries, a.genesis, a.anchored, a.signer.publicKey, a.stream),
    ).toEqual(a.anchored.claims);
  });

  it.each(['mutation', 'deletion', 'reordering', 'rewrite'])(
    'rejects audit %s against the independently retained checkpoint',
    async (kind) => {
      const { f, a, audit } = setup();
      await audit.record(organizationAuditEvent(f.request(), 'dispatch'));
      await audit.record(organizationAuditEvent(f.request(), 'complete'));
      let changed: IOrganizationAuditEntry[] = a.entries.map((item) => ({
        ...item,
        event: { ...item.event },
      }));
      if (kind === 'mutation')
        changed[0] = { ...changed[0]!, event: { ...changed[0]!.event, phase: 'unknown' } };
      if (kind === 'deletion') changed.pop();
      if (kind === 'reordering') changed.reverse();
      if (kind === 'rewrite') {
        let previous = a.genesis.claims.hash;
        changed = changed.map((item) => {
          const event = { ...item.event, phase: 'unknown' as const };
          const hash = organizationAuditHash(a.stream, item.sequence, previous, event);
          const rewritten = { ...item, event, previous, hash };
          previous = hash;
          return rewritten;
        });
      }
      expect(() =>
        verifyOrganizationAudit(changed, a.genesis, a.anchored, a.signer.publicKey, a.stream),
      ).toThrow();
    },
  );

  it('rejects a stored-history rollback while the independent checkpoint survives', async () => {
    const { f, a, audit } = setup();
    await audit.record(organizationAuditEvent(f.request(), 'dispatch'));
    const earlier = a.stored;
    await audit.record(organizationAuditEvent(f.request(), 'complete'));
    a.entries.pop();
    a.setStored(earlier);
    await expect(audit.record(organizationAuditEvent(f.request(), 'dispatch'))).rejects.toThrow(
      'policy-unavailable',
    );
    expect(a.anchored.claims.sequence).toBe(2);
    expect(a.entries).toHaveLength(1);
  });

  it('refuses wrong signer, wrong stream and alternate signature encoding before appending', async () => {
    const { f, a, options } = setup();
    for (const audit of [
      new OrganizationAudit({ ...options, publicKey: keys().publicKey }),
      new OrganizationAudit({ ...options, stream: 'other-audit' }),
      new OrganizationAudit({
        ...options,
        anchor: {
          ...a.anchor,
          load: async () => ({ ...a.anchored, signature: a.anchored.signature + '=' }),
        },
      }),
    ])
      await expect(audit.record(organizationAuditEvent(f.request(), 'dispatch'))).rejects.toThrow(
        'policy-unavailable',
      );
    expect(a.entries).toHaveLength(0);
  });

  it('holds an unanchored tail for explicit owner recovery without automatically retrying the effect', async () => {
    const { f, a, audit } = setup();
    const execute = vi.fn(async () => ({
      value: 'done',
      usage: { tokens: 1, timeMs: 0, costMicros: 1 },
    }));
    const broker = new OrganizationBroker({
      ledger: f.ledger,
      audit,
      actions: [
        {
          resource: 'asset',
          operation: 'read',
          roles: ['operator'],
          requiresApproval: false,
          reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
          execute,
        },
      ],
    });
    brokers.push(broker);
    a.setAnchorAvailable(false);
    const request = f.request();
    await expect(broker.apply(f.call(request))).rejects.toThrow('outcome-unknown');
    expect(execute).not.toHaveBeenCalled();
    expect(a.entries).toHaveLength(1);
    expect(a.anchored.claims.sequence).toBe(0);
    await expect(audit.record(organizationAuditEvent(f.request(), 'dispatch'))).rejects.toThrow(
      'policy-unavailable',
    );
    expect(a.entries).toHaveLength(1);
    a.setAnchorAvailable(true);
    expect((await audit.recover()).sequence).toBe(1);
    expect(f.ledger.budgetState('global').held.tokens).toBe(10);
    await expect(broker.apply(f.call({ ...request, nonce: 'fresh-proof' }))).rejects.toThrow(
      /outcome-unknown|operation-pending/,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute on lost anchor acknowledgement even if the checkpoint actually advanced', async () => {
    const { f, a, audit } = setup();
    a.setLoseAcknowledgement(true);
    await expect(audit.record(organizationAuditEvent(f.request(), 'dispatch'))).rejects.toThrow(
      'policy-unavailable',
    );
    expect(a.anchored.claims.sequence).toBe(1);
    expect((await audit.recover()).sequence).toBe(1);
  });

  it('serializes concurrent audit writers without conflicting histories or retrying an effect', async () => {
    const { f, a, audit, options } = setup();
    const other = new OrganizationAudit(options);
    const results = await Promise.allSettled([
      audit.record(organizationAuditEvent(f.request(), 'dispatch')),
      other.record(organizationAuditEvent(f.request(), 'dispatch')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(a.entries).toHaveLength(2);
    expect(a.anchored.claims.sequence).toBe(2);
    verifyOrganizationAudit(a.entries, a.genesis, a.anchored, a.signer.publicKey, a.stream);
  });

  it('stops a late lookup from starting persistence after the audit deadline', async () => {
    const { f, a, options } = setup();
    let release!: () => void;
    const read = vi.fn(a.sink.read);
    const append = vi.fn(a.sink.append);
    const audit = new OrganizationAudit({
      ...options,
      timeoutMs: 10,
      sink: { read, append },
      anchor: {
        ...a.anchor,
        load: () =>
          new Promise((resolve) => {
            release = () => resolve(a.anchored);
          }),
      },
    });
    await expect(audit.record(organizationAuditEvent(f.request(), 'dispatch'))).rejects.toThrow(
      'policy-unavailable',
    );
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(read).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('does not contact either storage port after an already aborted caller', async () => {
    const { f, a, options } = setup();
    const load = vi.fn(a.anchor.load);
    const audit = new OrganizationAudit({ ...options, anchor: { ...a.anchor, load } });
    const controller = new AbortController();
    controller.abort();
    await expect(
      audit.record(organizationAuditEvent(f.request(), 'dispatch'), controller.signal),
    ).rejects.toThrow('policy-unavailable');
    expect(load).not.toHaveBeenCalled();
  });

  it('does not publish a tampered pending tail during owner recovery', async () => {
    const { f, a, audit } = setup();
    a.setAnchorAvailable(false);
    await expect(audit.record(organizationAuditEvent(f.request(), 'dispatch'))).rejects.toThrow(
      'policy-unavailable',
    );
    a.entries[0] = { ...a.entries[0]!, hash: '0'.repeat(64) };
    a.setAnchorAvailable(true);
    await expect(audit.recover()).rejects.toThrow('policy-unavailable');
    expect(a.anchored.claims.sequence).toBe(0);
  });
});
