import { expect, it } from 'vitest';
import { OrganizationAudit, organizationAuditEvent } from '../audit.js';
import { auditFixture } from './audit-fixtures.js';
import { fixture } from './fixtures.js';

it('waits for a concurrent owner append to confirm its checkpoint without adopting an unconfirmed tail', async () => {
  const a = auditFixture(); const f = fixture();
  let appended!: () => void; let release!: () => void;
  const written = new Promise<void>((resolve) => { appended = resolve; });
  const confirmation = new Promise<void>((resolve) => { release = resolve; });
  const audit = new OrganizationAudit({ stream: a.stream, publicKey: a.signer.publicKey,
    sink: { read: a.sink.read, append: async (...args) => { const result = await a.sink.append(...args); appended(); return result; } },
    anchor: { load: a.anchor.load, compareAndSet: async (...args) => { await confirmation; return a.anchor.compareAndSet(...args); } },
  });
  try {
    const recording = audit.record(organizationAuditEvent(f.request(), 'dispatch'));
    await written;
    const readiness = audit.verify().then((head) => head.sequence, () => -1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(a.anchored.claims.sequence).toBe(0);
    release(); await recording;
    expect(await readiness).toBe(1);
  } finally { release(); f.cleanup(); }
});
