/** Runs inside a separate guest with its own synthetic identity only. */
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign, randomUUID } from 'node:crypto';
import { canonical } from './canonical-json.mjs';
const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const key = createPrivateKey(job.actorPrivate);
const records = [];
for (const item of job.requests) {
  const request = {
    credential: job.credential,
    operation: item.operation,
    approval: item.approval ?? null,
    nonce: item.nonce ?? randomUUID(),
  };
  if (item.credentialOverride) request.credential = item.credentialOverride;
  request.proof = sign(null, Buffer.from(canonical(request)), key).toString('base64url');
  if (item.corruptProof) request.proof = 'invalid-signature';
  try {
    const path = item.path ?? '/apply';
    if (path !== '/apply' && path !== '/admin') throw new Error('unsupported-broker-route');
    const endpoint =
      path === '/admin' ? 'http://127.0.0.1:19090/admin' : 'http://127.0.0.1:19090/apply';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: canonical(request),
      // Signed synthetic jobs stay on the owner-pinned loopback broker.
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    records.push({ status: response.status, result });
  } catch {
    records.push({ status: 0, result: { reason: 'transport-disconnected' } });
  }
}
process.stdout.write(JSON.stringify(records) + '\n');
