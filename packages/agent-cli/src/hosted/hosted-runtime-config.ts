import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createPublicKey } from 'node:crypto';

import type { TConfigEnvironment } from '@robota-sdk/product-config';
import type {
  IHostedBackend,
  IHostedIdentity,
  IHostedRuntimeConfig,
  IHostedRuntimeUsage,
  IHostedSnapshot,
} from './hosted-runtime-types.js';

export function hostedAdmissionError(reason: string): Error {
  return new Error(`Hosted runtime admission refused: ${reason}`);
}

/** The private local worker entry cannot authorize a hosted execution composition. */
export function assertLocalWorkerPosture(environment: TConfigEnvironment): void {
  if (readHostedRuntimeConfig(environment) !== undefined) {
    throw hostedAdmissionError(
      'local subagent worker is unavailable in hosted posture; host execution is refused',
    );
  }
}

export function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw hostedAdmissionError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw hostedAdmissionError(`${name} has missing or unsupported fields`);
  }
}

export function identifier(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
    })
  ) {
    throw hostedAdmissionError(`${name} must be a bounded identifier without control characters`);
  }
  return value;
}

export function positiveInteger(
  value: unknown,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw hostedAdmissionError(`${name} must be a positive bounded integer`);
  }
  return value;
}

/** Cumulative counts and owner ceilings use the same closed nonnegative integer shape. */
export function decodeHostedRuntimeUsage(value: unknown): IHostedRuntimeUsage {
  const usage = record(value, 'runtime usage');
  exactKeys(usage, ['sessions', 'modelCalls', 'modelTokens', 'costMicros'], 'runtime usage');
  for (const key of ['sessions', 'modelCalls', 'modelTokens', 'costMicros'] as const)
    if (typeof usage[key] !== 'number' || !Number.isSafeInteger(usage[key]) || usage[key] < 0)
      throw hostedAdmissionError('runtime usage requires nonnegative safe integers');
  return Object.freeze({ sessions: usage.sessions as number, modelCalls: usage.modelCalls as number,
    modelTokens: usage.modelTokens as number, costMicros: usage.costMicros as number });
}

export function decodeHostedIdentity(value: unknown): IHostedIdentity {
  const identity = record(value, 'identity');
  exactKeys(identity, ['tenant', 'task', 'rootTask', 'actor', 'runtime'], 'identity');
  return Object.freeze({
    tenant: identifier(identity.tenant, 'tenant'),
    task: identifier(identity.task, 'task'),
    rootTask: identifier(identity.rootTask, 'root task'),
    actor: identifier(identity.actor, 'actor'),
    runtime: identifier(identity.runtime, 'runtime'),
  });
}

export function decodeHostedSnapshot(value: unknown): IHostedSnapshot | null {
  if (value === null) return null;
  const snapshot = record(value, 'snapshot');
  exactKeys(snapshot, ['id', 'digest'], 'snapshot');
  if (typeof snapshot.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(snapshot.digest)) {
    throw hostedAdmissionError('snapshot digest must be SHA-256');
  }
  return Object.freeze({ id: identifier(snapshot.id, 'snapshot id'), digest: snapshot.digest });
}

function decodeBackend(value: unknown, name: string): IHostedBackend {
  const backend = record(value, name);
  exactKeys(backend, ['endpoint', 'resource', 'publicKey'], name);
  const endpoint = identifier(backend.endpoint, `${name} endpoint`);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw hostedAdmissionError(`${name} endpoint is invalid`);
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw hostedAdmissionError(
      `${name} endpoint requires TLS or a literal loopback address, without URL credentials`,
    );
  }
  if (
    typeof backend.publicKey !== 'string' ||
    backend.publicKey.length > 8192 ||
    !backend.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')
  ) {
    throw hostedAdmissionError(`${name} public key is invalid`);
  }
  try {
    if (createPublicKey(backend.publicKey).asymmetricKeyType !== 'ed25519')
      throw new Error('key type');
  } catch {
    throw hostedAdmissionError(`${name} requires an Ed25519 public key`);
  }
  return Object.freeze({
    endpoint,
    resource: identifier(backend.resource, `${name} resource`),
    publicKey: backend.publicKey,
  });
}

export function decodeHostedRuntimeConfig(value: unknown): IHostedRuntimeConfig {
  const config = record(value, 'deployment configuration');
  exactKeys(
    config,
    [
      'version',
      'identity',
      'epoch',
      'worker',
      'broker',
      'snapshot',
      'lifetimeMs',
      'probeTimeoutMs',
      'limits',
    ],
    'deployment configuration',
  );
  if (config.version !== 3)
    throw hostedAdmissionError('unsupported deployment configuration version');
  const identity = decodeHostedIdentity(config.identity);
  const worker = decodeBackend(config.worker, 'worker');
  const broker = decodeBackend(config.broker, 'broker');
  if (worker.resource === identity.runtime || worker.resource === broker.resource) {
    throw hostedAdmissionError('worker must have a distinct resource identity');
  }
  return Object.freeze({
    version: 3,
    identity,
    epoch: positiveInteger(config.epoch, 'epoch'),
    worker,
    broker,
    snapshot: decodeHostedSnapshot(config.snapshot),
    lifetimeMs: positiveInteger(config.lifetimeMs, 'lifetimeMs', 86_400_000),
    probeTimeoutMs: positiveInteger(config.probeTimeoutMs, 'probeTimeoutMs', 30_000),
    limits: decodeHostedRuntimeUsage(config.limits),
  });
}

/** Missing hosted capabilities never become the local opt-out or an OS sandbox. */
export function readHostedRuntimeConfig(
  environment: TConfigEnvironment,
): IHostedRuntimeConfig | undefined {
  const posture = environment.PRODUCT_RUNTIME_POSTURE;
  const file = environment.PRODUCT_HOSTED_RUNTIME_CONFIG;
  if ((posture === undefined || posture === 'local') && file === undefined) return undefined;
  if (posture !== 'hosted')
    throw hostedAdmissionError('deployment configuration cannot opt out of hosted posture');
  if (typeof file !== 'string' || file.length === 0) {
    throw hostedAdmissionError('mandatory worker and broker deployment configuration is missing');
  }
  if (!isAbsolute(file))
    throw hostedAdmissionError('deployment configuration requires an absolute path');
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536 || (stat.mode & 0o022) !== 0) {
      throw hostedAdmissionError(
        'deployment configuration is not a bounded, owner-controlled regular file',
      );
    }
    if (process.getuid !== undefined && stat.uid !== process.getuid() && stat.uid !== 0) {
      throw hostedAdmissionError('deployment configuration has an untrusted owner');
    }
    return decodeHostedRuntimeConfig(JSON.parse(readFileSync(fd, 'utf8')) as unknown);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Hosted runtime admission refused:'))
      throw error;
    throw hostedAdmissionError('deployment configuration is missing, unreadable or corrupt');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
