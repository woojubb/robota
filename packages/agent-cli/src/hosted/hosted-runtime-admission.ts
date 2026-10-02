import { randomBytes, verify } from 'node:crypto';
import {
  decodeHostedIdentity,
  decodeHostedRuntimeUsage,
  decodeHostedSnapshot,
  exactKeys,
  hostedAdmissionError,
  identifier,
  positiveInteger,
  readHostedRuntimeConfig,
  record,
} from './hosted-runtime-config.js';

import type {
  IHostedAdmission,
  IHostedAdmissionOptions,
  IHostedAdmissionProof,
  IHostedRuntimeConfig,
  THostedBackendRole,
  IHostedRuntimeUsage,
} from './hosted-runtime-types.js';

function usageTuple(usage: IHostedRuntimeUsage): readonly number[] {
  return [usage.sessions, usage.modelCalls, usage.modelTokens, usage.costMicros];
}

/** Fixed typed tuple defines the UTF-8 signature domain; object order is not part of the protocol. */
export function hostedAdmissionBytes(proof: Omit<IHostedAdmissionProof, 'signature'>): Buffer {
  return Buffer.from(
    JSON.stringify([
      'robota/hosted-admission/v3',
      proof.version,
      proof.identity.tenant,
      proof.identity.task,
      proof.identity.rootTask,
      proof.identity.actor,
      proof.identity.runtime,
      proof.role,
      proof.resource,
      proof.nonce,
      proof.epoch,
      proof.issuedAt,
      proof.expiresAt,
      proof.snapshot === null ? null : [proof.snapshot.id, proof.snapshot.digest],
      proof.ready,
      usageTuple(proof.limits),
      proof.usage === null ? null : usageTuple(proof.usage),
    ]),
    'utf8',
  );
}

export function verifyHostedAdmissionProof(
  value: unknown,
  config: IHostedRuntimeConfig,
  role: THostedBackendRole,
  nonce: string,
  now: number,
): IHostedAdmissionProof {
  const raw = record(value, 'admission proof');
  exactKeys(
    raw,
    [
      'version',
      'identity',
      'role',
      'resource',
      'nonce',
      'epoch',
      'issuedAt',
      'expiresAt',
      'snapshot',
      'ready',
      'limits',
      'usage',
      'signature',
    ],
    'admission proof',
  );
  if (raw.version !== 3 || raw.role !== role || raw.ready !== true) {
    throw hostedAdmissionError(`${role} does not provide a ready, supported admission proof`);
  }
  const backend = config[role];
  const proof: IHostedAdmissionProof = Object.freeze({
    version: 3,
    identity: decodeHostedIdentity(raw.identity),
    role,
    resource: identifier(raw.resource, 'proof resource'),
    nonce: identifier(raw.nonce, 'proof nonce'),
    epoch: positiveInteger(raw.epoch, 'proof epoch'),
    issuedAt: positiveInteger(raw.issuedAt, 'proof issuedAt'),
    expiresAt: positiveInteger(raw.expiresAt, 'proof expiresAt'),
    snapshot: decodeHostedSnapshot(raw.snapshot),
    ready: true,
    limits: decodeHostedRuntimeUsage(raw.limits),
    usage: raw.usage === null ? null : decodeHostedRuntimeUsage(raw.usage),
    signature: identifier(raw.signature, 'proof signature'),
  });
  if ((role === 'worker') !== (proof.usage === null))
    throw hostedAdmissionError('only broker admission supplies mandatory runtime usage');
  if (JSON.stringify(proof.limits) !== JSON.stringify(config.limits))
    throw hostedAdmissionError('broker and worker must attest the owner runtime usage limits');
  if (
    Object.entries(config.identity).some(
      ([key, expected]) => proof.identity[key as keyof typeof proof.identity] !== expected,
    ) ||
    proof.resource !== backend.resource ||
    proof.nonce !== nonce ||
    proof.epoch !== config.epoch
  ) {
    throw hostedAdmissionError(`${role} identity, challenge or policy epoch does not match`);
  }
  if (proof.issuedAt > now || proof.expiresAt <= now || proof.expiresAt - proof.issuedAt > 60_000) {
    throw hostedAdmissionError(
      `${role} admission proof is expired or outside its bounded lifetime`,
    );
  }
  if (JSON.stringify(proof.snapshot) !== JSON.stringify(config.snapshot)) {
    throw hostedAdmissionError(
      `${role} snapshot is missing, corrupt or bound to another checkpoint`,
    );
  }
  const signature = Buffer.from(proof.signature, 'base64url');
  if (
    signature.length !== 64 ||
    signature.toString('base64url') !== proof.signature ||
    !verify(null, hostedAdmissionBytes(proof), backend.publicKey, signature)
  ) {
    throw hostedAdmissionError(`${role} signature is invalid`);
  }
  return proof;
}

async function probe(
  config: IHostedRuntimeConfig,
  role: THostedBackendRole,
  nonce: string,
  options: IHostedAdmissionOptions,
): Promise<IHostedAdmissionProof> {
  const signal =
    options.signal === undefined
      ? AbortSignal.timeout(config.probeTimeoutMs)
      : AbortSignal.any([options.signal, AbortSignal.timeout(config.probeTimeoutMs)]);
  try {
    const response = await fetch(config[role].endpoint, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 3,
        identity: config.identity,
        role,
        resource: config[role].resource,
        nonce,
        epoch: config.epoch,
        snapshot: config.snapshot,
        limits: config.limits,
      }),
    });
    if (!response.ok || response.body === null) throw new Error('backend unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      let next = await reader.read();
      while (!next.done) {
        size += next.value.length;
        if (size > 65_536) throw hostedAdmissionError(`${role} proof exceeds the response limit`);
        chunks.push(next.value);
        next = await reader.read();
      }
    } finally {
      await reader.cancel();
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return verifyHostedAdmissionProof(body, config, role, nonce, (options.now ?? Date.now)());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Hosted runtime admission refused:'))
      throw error;
    throw hostedAdmissionError(`${role} backend is unavailable or returned an invalid proof`);
  }
}

export async function admitHostedRuntime(
  options: IHostedAdmissionOptions,
): Promise<IHostedAdmission | undefined> {
  const config = readHostedRuntimeConfig(options.environment);
  if (config === undefined) return undefined;
  if (options.resume && config.snapshot === null)
    throw hostedAdmissionError('resume requires a verified worker snapshot');
  const nonce = randomBytes(32).toString('base64url');
  const [worker, broker] = await Promise.all([
    probe(config, 'worker', nonce, options),
    probe(config, 'broker', nonce, options),
  ]);
  const completedAt = (options.now ?? Date.now)();
  verifyHostedAdmissionProof(worker, config, 'worker', nonce, completedAt);
  verifyHostedAdmissionProof(broker, config, 'broker', nonce, completedAt);
  return Object.freeze({
    config,
    worker,
    broker,
    expiresAt: Math.min(worker.expiresAt, broker.expiresAt),
  });
}
