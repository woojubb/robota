import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hostedAdmissionBytes } from '../hosted-runtime-admission.js';
import { hostedWorkerAccessBytes } from '../hosted-worker-execution-config.js';
import type { IHostedWorkerAccess } from '../hosted-worker-execution-config.js';
import type {
  IHostedAdmissionProof,
  IHostedRuntimeConfig,
  IHostedRuntimeUsage,
  THostedBackendRole,
} from '../hosted-runtime-types.js';

export async function hostedFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'hosted-proof-'));
  const keys = generateKeyPairSync('ed25519');
  let transform = (proof: Omit<IHostedAdmissionProof, 'signature'>): unknown => proof;
  let replay: ((proof: IHostedAdmissionProof) => unknown) | undefined;
  let unavailable: THostedBackendRole | undefined;
  let brokerDelayMs = 0;
  let proofLifetimeMs = 10_000;
  let requests = 0;
  let modelHandler:
    ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined;
  let admissionHandler: ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
  const server = createServer(async (request, response) => {
    if (
      ['/v1/chat/completions', '/v1/responses'].includes(request.url ?? '') &&
      modelHandler !== undefined
    ) {
      await modelHandler(request, response);
      return;
    }
    if (admissionHandler !== undefined) { admissionHandler(request, response); return; }
    requests++;
    const role = request.url === '/worker' ? 'worker' : 'broker';
    if (unavailable === role) {
      response.writeHead(503).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const issuedAt = Date.now();
    const unsigned = transform({
      version: 3,
      identity: config.identity,
      role,
      resource: config[role].resource,
      nonce: body.nonce as string,
      epoch: config.epoch,
      issuedAt,
      expiresAt: issuedAt + proofLifetimeMs,
      snapshot: config.snapshot,
      ready: true,
      limits: issuedLimits,
      usage: role === 'broker' ? usage : null,
    }) as Omit<IHostedAdmissionProof, 'signature'>;
    const signature = sign(null, hostedAdmissionBytes(unsigned), keys.privateKey).toString(
      'base64url',
    );
    const proof = { ...unsigned, signature };
    if (role === 'broker' && brokerDelayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, brokerDelayMs));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(replay?.(proof) ?? proof));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('fixture did not listen');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const config: IHostedRuntimeConfig = {
    version: 3,
    identity: {
      tenant: 'tenant-한글',
      task: 'task-🚀',
      rootTask: 'root-task',
      actor: 'actor-1',
      runtime: 'runtime-1',
    },
    epoch: 3,
    worker: { endpoint: `${endpoint}/worker`, resource: 'worker-1', publicKey },
    broker: { endpoint: `${endpoint}/broker`, resource: 'broker-1', publicKey },
    snapshot: null,
    lifetimeMs: 3000,
    probeTimeoutMs: 1000,
    limits: { sessions: 1000, modelCalls: 1000, modelTokens: 1_000_000, costMicros: 1_000_000 },
  };
  let usage: IHostedRuntimeUsage = { sessions: 1, modelCalls: 0, modelTokens: 0, costMicros: 0 };
  let issuedLimits = config.limits;
  const file = join(directory, 'deployment.json');
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  return {
    config,
    file,
    directory,
    environment: { PRODUCT_RUNTIME_POSTURE: 'hosted', PRODUCT_HOSTED_RUNTIME_CONFIG: file },
    signWorkerAccess: (access: Omit<IHostedWorkerAccess, 'signature'>): IHostedWorkerAccess => ({
      ...access,
      signature: sign(null, hostedWorkerAccessBytes(access), keys.privateKey).toString('base64url'),
    }),
    signAdmissionBytes: (bytes: Uint8Array): string => sign(null, bytes, keys.privateKey).toString('base64url'),
    setAdmissionHandler: (next: typeof admissionHandler) => { admissionHandler = next; },
    setUsage: (next: IHostedRuntimeUsage) => { usage = { ...next }; },
    usage: () => ({ ...usage }),
    setModelHandler: (next: typeof modelHandler) => {
      modelHandler = next;
    },
    setProofTransform: (next: typeof transform) => {
      transform = next;
    },
    setReplay: (next: typeof replay) => {
      replay = next;
    },
    setUnavailable: (role: typeof unavailable) => {
      unavailable = role;
    },
    setBrokerDelay: (ms: number) => {
      brokerDelayMs = ms;
    },
    setProofLifetime: (ms: number) => {
      proofLifetimeMs = ms;
    },
    requests: () => requests,
    writeConfig: (value: unknown) => {
      issuedLimits = (value as { limits?: IHostedRuntimeUsage }).limits ?? config.limits;
      writeFileSync(file, JSON.stringify(value));
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
