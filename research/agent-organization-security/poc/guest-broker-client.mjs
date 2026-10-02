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
    const response = await fetch('http://127.0.0.1:19090' + (item.path ?? '/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: canonical(request),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    records.push({ status: response.status, result });
  } catch {
    records.push({ status: 0, result: { reason: 'transport-disconnected' } });
  }
}
process.stdout.write(JSON.stringify(records) + '\n');
