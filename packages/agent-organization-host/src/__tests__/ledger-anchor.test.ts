import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { OrganizationBroker, OrganizationLedger } from '../index.js';
import type { IOrganizationLedgerAnchor, IOrganizationLedgerHead } from '../index.js';
import { fixture } from './fixtures.js';

function anchor() {
  let current: IOrganizationLedgerHead | undefined;
  return { ledger: 'owner-policy', read: () => current,
    compareAndSet: (expected: IOrganizationLedgerHead | undefined, next: IOrganizationLedgerHead) => {
      if (JSON.stringify(expected) !== JSON.stringify(current)) throw new Error('anchor conflict');
      current = { ...next };
    },
  };
}

it('refuses reopening an existing authority store when its independent checkpoint is missing', () => {
  const f = fixture();
  try {
    f.ledger.close();
    let reopened: OrganizationLedger | undefined;
    try {
      expect(() => { reopened = new OrganizationLedger({ ...f.ledgerOptions, anchor: anchor() }); }).toThrow(/policy-unavailable/u);
    } finally { reopened?.close(); }
  } finally { f.cleanup(); }
});

it('anchors mutations while unchanged policy reads preserve the retained revision', () => {
  const retained = anchor();
  const f = fixture({ anchor: retained });
  try {
    const before = retained.read()!;
    f.ledger.verifyAnchoredAuthority();
    f.ledger.currentGrant(f.grant.id);
    expect(retained.read()).toEqual(before);
    f.ledger.revokeGrant(f.grant.id);
    expect(retained.read()!.revision).toBe(before.revision + 1);
    expect(retained.read()!.digest).not.toBe(before.digest);
    expect(() => f.ledger.currentGrant(f.grant.id)).toThrow(/revoked/u);
  } finally { f.cleanup(); }
});

it.each(['write-lost-ack', 'read-unavailable', 'missing', 'wrong-ledger', 'unconfirmed'])(
  'refuses uncertain or changed independent authority instead of recreating capacity: %s', (fault) => {
    const retained = anchor();
    let armed = false;
    const port: IOrganizationLedgerAnchor = {
      ledger: retained.ledger,
      read: () => {
        if (armed && fault === 'read-unavailable') throw new Error('owner anchor outage');
        if (armed && fault === 'missing') return undefined;
        const head = retained.read();
        return armed && fault === 'wrong-ledger' && head ? { ...head, ledger: 'another-policy' } : head;
      },
      compareAndSet: (expected, next) => {
        if (armed && fault === 'unconfirmed') return;
        retained.compareAndSet(expected, next);
        if (armed && fault === 'write-lost-ack') throw new Error('lost acknowledgement');
      },
    };
    const f = fixture({ anchor: port });
    try {
      const before = retained.read();
      armed = true;
      expect(() => f.ledger.revokeGrant(f.grant.id)).toThrow(/policy-unavailable/u);
      if (fault === 'write-lost-ack') {
        expect(retained.read()!.revision).toBe(before!.revision + 1);
        expect(() => f.ledger.currentGrant(f.grant.id)).toThrow(/policy-unavailable/u);
      } else if (fault !== 'unconfirmed') {
        expect(() => f.ledger.currentGrant(f.grant.id)).toThrow(/policy-unavailable/u);
      }
    } finally { f.cleanup(); }
  },
);

it('refuses a restored old database instead of recovering already consumed authority or budget', async () => {
  const retained = anchor();
  const f = fixture({ anchor: retained });
  try {
    f.ledger.close();
    const old = readFileSync(f.path);
    const current = new OrganizationLedger({ ...f.ledgerOptions, anchor: retained });
    const broker = new OrganizationBroker({ ledger: current, actions: [{
      resource: 'asset', operation: 'read', roles: ['operator'], requiresApproval: false,
      reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
      execute: async () => ({ value: 'effect', usage: { tokens: 2, timeMs: 0, costMicros: 2 } }),
    }] });
    await broker.apply(f.call(f.request()));
    current.stopTask('company', 'task');
    const latest = retained.read();
    broker.close(); current.close();
    writeFileSync(f.path, old);
    let reopened: OrganizationLedger | undefined;
    try {
      expect(() => { reopened = new OrganizationLedger({ ...f.ledgerOptions, anchor: retained }); }).toThrow(/policy-unavailable/u);
      expect(retained.read()).toEqual(latest);
    } finally { reopened?.close(); }
  } finally { f.cleanup(); }
});
