import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { OrganizationAudit, OrganizationAuditAppendConflict } from '../audit.js';
import { createOrganizationAuditHttpPorts } from '../audit-http.js';
import { OrganizationFileLedgerAnchor } from '../file-ledger-anchor.js';
import { OrganizationLedger } from '../sqlite-ledger.js';
import { auditFixture } from './audit-fixtures.js';
import { fixture } from './fixtures.js';

it('retains independent ledger authority across reopening and refuses stale concurrent CAS or a crash-held lock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-custody-'));
  const anchor = new OrganizationFileLedgerAnchor({ directory, ledger: 'company' });
  const f = fixture({ anchor });
  try {
    const before = anchor.read()!;
    f.ledger.revokeGrant(f.grant.id);
    const latest = anchor.read()!;
    expect(() => anchor.compareAndSet(before, { ...latest, revision: before.revision + 1 })).toThrow(/policy-unavailable/u);
    f.ledger.close();
    const reopened = new OrganizationLedger({ ...f.ledgerOptions, anchor: new OrganizationFileLedgerAnchor({ directory, ledger: 'company' }) });
    try { expect(() => reopened.currentGrant(f.grant.id)).toThrow(/revoked/u); }
    finally { reopened.close(); }
    // A symlink/file substituted for the lock must never be removed or treated as permission to write.
    writeFileSync(join(directory, 'head.lock'), 'uncertain owner mutation', { mode: 0o600 });
    expect(() => anchor.compareAndSet(latest, { ...latest, revision: latest.revision + 1 })).toThrow(/policy-unavailable/u);
    expect(anchor.read()).toEqual(latest);
  } finally { f.cleanup(); rmSync(directory, { recursive: true, force: true }); }
});

it('uses authenticated owner HTTP ports and detects deletion without disclosing payload secrets', async () => {
  const a = auditFixture();
  const token = 'owner-transport-secret-'.padEnd(40, 'x');
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(input);
    let result: unknown;
    try {
      if (request.url === '/read') result = await a.sink.read(input, AbortSignal.timeout(1000));
      else if (request.url === '/append') result = await a.sink.append(input.expected, input.event, AbortSignal.timeout(1000));
      else if (request.url === '/load') result = await a.anchor.load(AbortSignal.timeout(1000));
      else if (request.url === '/cas') result = await a.anchor.compareAndSet(input.expected, input.next, AbortSignal.timeout(1000));
      else throw new Error('unknown route');
      response.end(JSON.stringify(result));
    } catch (error) { response.writeHead(error instanceof OrganizationAuditAppendConflict ? 409 : 503).end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no address');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const ports = createOrganizationAuditHttpPorts({ sink: { endpoint, token }, anchor: { endpoint, token } });
  const audit = new OrganizationAudit({ ...ports, stream: a.stream, publicKey: a.signer.publicKey });
  const f = fixture();
  try {
    const secret = 'payload-secret-canary';
    const { organizationAuditEvent } = await import('../audit.js');
    await audit.record(organizationAuditEvent(f.request({ operation: { idempotencyKey: 'request', resource: 'asset', operation: 'read', environment: 'test', parameters: secret } }), 'dispatch'));
    await audit.verify();
    expect(JSON.stringify(requests)).not.toContain(secret);
    expect(JSON.stringify(requests)).not.toContain(token);
    a.setStored(a.genesis);
    await expect(audit.verify()).rejects.toThrow(/policy-unavailable/u);
  } finally { f.cleanup(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
