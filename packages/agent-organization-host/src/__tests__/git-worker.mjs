import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { organizationCanonical, organizationSigningBytes } from '../../dist/node/index.js';

let identity;
let key;
process.send({ kind: 'ready' });
process.on('message', (message) => {
  if (message.kind === 'initialize') {
    identity = message.grant;
    key = createPrivateKey(message.workerKey);
    process.send({ kind: 'initialized' });
    return;
  }
  if (message.kind !== 'apply') return;
  const now = Date.now();
  const claims = {
    version: 1,
    grantId: identity.id,
    tenant: identity.tenant,
    task: identity.task,
    actor: identity.actor,
    audience: identity.audience,
    epoch: identity.epoch,
    nonce: randomUUID(),
    notBefore: Math.max(identity.notBefore, now - 100),
    expiresAt: Math.min(identity.expiresAt, now + 20_000),
    operation: {
      idempotencyKey: message.idempotencyKey ?? randomUUID(),
      resource: 'source',
      operation: message.operation,
      environment: 'test',
      parameters: message.parameters,
    },
  };
  const call = {
    request: {
      claims,
      signature: sign(null, organizationSigningBytes('request', claims), key).toString('base64url'),
    },
    approval: message.approval ?? null,
  };
  const request = httpRequest(
    message.endpoint + '/v1/apply',
    {
      method: 'POST',
      headers: {
        host: new URL(identity.audience).host,
        'content-type': 'application/json',
      },
    },
    (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        try {
          process.send({
            kind: 'result',
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            request: claims,
          });
        } catch {
          process.send({
            kind: 'result',
            status: 503,
            body: { refused: 'fixture-response-error' },
            request: claims,
          });
        }
      });
    },
  );
  request.setTimeout(5000, () => request.destroy());
  request.once('error', () =>
    process.send({
      kind: 'result',
      status: 503,
      body: { refused: 'transport-lost' },
      request: claims,
    }),
  );
  request.end(organizationCanonical(call));
});
