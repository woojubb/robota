import { expect, it } from 'vitest';
import { OrganizationAudit } from '../audit.js';
import { OrganizationBroker } from '../broker.js';
import type { IOrganizationLedgerHead } from '../ledger-anchor.js';
import { auditFixture } from './audit-fixtures.js';
import { fixture } from './fixtures.js';

it('refuses hosted dispatch without independently anchored authority and audit', () => {
  const plain = fixture();
  const a = auditFixture();
  const audit = new OrganizationAudit({ stream: a.stream, publicKey: a.signer.publicKey, sink: a.sink, anchor: a.anchor });
  try {
    expect(() => new OrganizationBroker({ ledger: plain.ledger, actions: [], audit, hosted: true } as never)).toThrow(/policy-unavailable/u);
  } finally { plain.cleanup(); }
  let head: IOrganizationLedgerHead | undefined;
  const f = fixture({ anchor: { ledger: 'owner', read: () => head, compareAndSet: (_expected, next) => { head = next; } } });
  try {
    expect(() => new OrganizationBroker({ ledger: f.ledger, actions: [], hosted: true } as never)).toThrow(/policy-unavailable/u);
    expect(() => new OrganizationBroker({ ledger: f.ledger, actions: [], audit: { record: async () => undefined }, hosted: true } as never)).toThrow(/policy-unavailable/u);
    const broker = new OrganizationBroker({ ledger: f.ledger, actions: [], audit, hosted: true } as never);
    broker.close();
  } finally { f.cleanup(); }
});
