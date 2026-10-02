import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, posix } from 'node:path';
import { verify } from 'node:crypto';
import {
  decodeHostedIdentity,
  exactKeys,
  hostedAdmissionError,
  identifier,
  positiveInteger,
  record,
} from './hosted-runtime-config.js';
import { isSafeSessionId } from '@robota-sdk/agent-session';
import type { TConfigEnvironment } from '@robota-sdk/product-config';
import type { IHostedAdmission, IHostedIdentity } from './hosted-runtime-types.js';

/** Issued by the admitted broker, never inferred from a provider API key or a worker claim. */
export interface IHostedWorkerAccess {
  readonly version: 1;
  readonly identity: IHostedIdentity;
  readonly worker: string;
  readonly broker: string;
  readonly epoch: number;
  readonly endpoint: string;
  readonly token: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly signature: string;
}

export interface IHostedWorkerResumeSession {
  readonly id: string;
  readonly path: string;
  readonly digest: string;
}

/** Private runtime ingress; the worker gets a different, per-launch credential. */
export interface IHostedWorkerServe {
  readonly port: number;
  readonly workerPort: number;
  readonly token: string;
}

interface IWorkerArtifact {
  readonly path: string;
  readonly digest: string;
}

/** Operator-selected template artifacts and a broker-issued task credential. */
export interface IHostedWorkerExecutionConfig {
  readonly version: 1;
  readonly templateId: string;
  readonly nodeExecutable: string;
  readonly entrypoint: IWorkerArtifact;
  readonly productConfig: IWorkerArtifact;
  readonly workspaceRoot: string;
  readonly access: IHostedWorkerAccess;
  readonly resumeSession?: IHostedWorkerResumeSession;
  readonly serve?: IHostedWorkerServe;
}

export function hostedWorkerAccessBytes(access: Omit<IHostedWorkerAccess, 'signature'>): Buffer {
  return Buffer.from(
    JSON.stringify([
      'robota/hosted-worker-access/v1',
      access.version,
      access.identity.tenant,
      access.identity.task,
      access.identity.rootTask,
      access.identity.actor,
      access.identity.runtime,
      access.worker,
      access.broker,
      access.epoch,
      access.endpoint,
      access.token,
      access.issuedAt,
      access.expiresAt,
    ]),
    'utf8',
  );
}

function workerPath(value: unknown, label: string): string {
  const path = identifier(value, label);
  if (
    !posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path === '/' ||
    path.includes('\\')
  )
    throw hostedAdmissionError(`${label} requires a normalized absolute worker path`);
  return path;
}

function artifact(value: unknown, label: string): IWorkerArtifact {
  const data = record(value, label);
  exactKeys(data, ['path', 'digest'], label);
  if (typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(data.digest))
    throw hostedAdmissionError(`${label} requires a SHA-256 digest`);
  return Object.freeze({ path: workerPath(data.path, label), digest: data.digest });
}

export function verifyHostedWorkerAccess(
  value: unknown,
  admission: IHostedAdmission,
  now = Date.now(),
): IHostedWorkerAccess {
  const data = record(value, 'worker broker access');
  exactKeys(
    data,
    [
      'version',
      'identity',
      'worker',
      'broker',
      'epoch',
      'endpoint',
      'token',
      'issuedAt',
      'expiresAt',
      'signature',
    ],
    'worker broker access',
  );
  if (data.version !== 1) throw hostedAdmissionError('unsupported worker broker access version');
  const access: IHostedWorkerAccess = Object.freeze({
    version: 1,
    identity: decodeHostedIdentity(data.identity),
    worker: identifier(data.worker, 'access worker'),
    broker: identifier(data.broker, 'access broker'),
    epoch: positiveInteger(data.epoch, 'access epoch'),
    endpoint: identifier(data.endpoint, 'access endpoint'),
    token: identifier(data.token, 'task broker credential'),
    issuedAt: positiveInteger(data.issuedAt, 'access issuedAt'),
    expiresAt: positiveInteger(data.expiresAt, 'access expiresAt'),
    signature: identifier(data.signature, 'access signature'),
  });
  if (
    Object.entries(admission.config.identity).some(
      ([key, expected]) => access.identity[key as keyof IHostedIdentity] !== expected,
    ) ||
    access.worker !== admission.config.worker.resource ||
    access.broker !== admission.config.broker.resource ||
    access.epoch !== admission.config.epoch
  )
    throw hostedAdmissionError('worker broker credential is bound to another admitted authority');
  let endpoint: URL;
  try {
    endpoint = new URL(access.endpoint);
  } catch {
    throw hostedAdmissionError('worker broker endpoint is invalid');
  }
  const broker = new URL(admission.config.broker.endpoint);
  if (
    endpoint.origin !== broker.origin ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    /\s/u.test(access.token)
  )
    throw hostedAdmissionError('worker broker endpoint or credential is unsupported');
  if (
    access.issuedAt > now ||
    access.expiresAt <= now ||
    access.expiresAt > admission.expiresAt ||
    access.expiresAt - access.issuedAt > 60_000
  )
    throw hostedAdmissionError('worker broker credential is expired or exceeds its admission');
  const signature = Buffer.from(access.signature, 'base64url');
  if (
    signature.length !== 64 ||
    signature.toString('base64url') !== access.signature ||
    !verify(null, hostedWorkerAccessBytes(access), admission.config.broker.publicKey, signature)
  )
    throw hostedAdmissionError('worker broker credential signature is invalid');
  return access;
}

export function decodeHostedWorkerExecutionConfig(
  value: unknown,
  admission: IHostedAdmission,
): IHostedWorkerExecutionConfig {
  const data = record(value, 'worker execution configuration');
  exactKeys(
    data,
    [
      'version',
      'templateId',
      'nodeExecutable',
      'entrypoint',
      'productConfig',
      'workspaceRoot',
      'access',
      ...(data.resumeSession === undefined ? [] : ['resumeSession']),
      ...(data.serve === undefined ? [] : ['serve']),
    ],
    'worker execution configuration',
  );
  if (data.version !== 1) throw hostedAdmissionError('unsupported worker execution version');
  const workspaceRoot = workerPath(data.workspaceRoot, 'worker workspace');
  let resumeSession: IHostedWorkerResumeSession | undefined;
  let serve: IHostedWorkerServe | undefined;
  if (data.serve !== undefined) {
    const selected = record(data.serve, 'worker serve ingress');
    exactKeys(selected, ['port', 'workerPort', 'token'], 'worker serve ingress');
    if (!Number.isSafeInteger(selected.port) || (selected.port as number) < 0 ||
      (selected.port as number) > 65_535 || !Number.isSafeInteger(selected.workerPort) ||
      (selected.workerPort as number) < 1 || (selected.workerPort as number) > 65_535 ||
      typeof selected.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(selected.token))
      throw hostedAdmissionError('worker serve ingress requires valid ports and an owner client token');
    serve = Object.freeze({ port: selected.port as number, workerPort: selected.workerPort as number, token: selected.token });
  }
  if (data.resumeSession !== undefined) {
    const session = record(data.resumeSession, 'worker conversation checkpoint');
    exactKeys(session, ['id', 'path', 'digest'], 'worker conversation checkpoint');
    const id = identifier(session.id, 'conversation checkpoint selector');
    const selected = artifact({ path: session.path, digest: session.digest }, 'conversation checkpoint artifact');
    if (admission.config.snapshot === null || !isSafeSessionId(id) ||
      selected.path !== posix.join(workspaceRoot, '.home', '.checkpoint-sessions', `${id}.json`))
      throw hostedAdmissionError('conversation checkpoint requires admitted recovery and private task state');
    resumeSession = Object.freeze({ id, ...selected });
  }
  return Object.freeze({
    version: 1,
    templateId: identifier(data.templateId, 'worker template'),
    nodeExecutable: workerPath(data.nodeExecutable, 'worker Node executable'),
    entrypoint: artifact(data.entrypoint, 'worker CLI artifact'),
    productConfig: artifact(data.productConfig, 'worker product configuration'),
    workspaceRoot,
    ...(resumeSession === undefined ? {} : { resumeSession }),
    ...(serve === undefined ? {} : { serve }),
    access: verifyHostedWorkerAccess(data.access, admission),
  });
}

/** Contains a task credential, so only the owner/root may read or mutate this local input. */
export function readHostedWorkerExecutionConfig(
  environment: TConfigEnvironment,
  admission: IHostedAdmission,
): IHostedWorkerExecutionConfig {
  const file = environment.PRODUCT_HOSTED_WORKER_EXECUTION_CONFIG;
  if (typeof file !== 'string' || !isAbsolute(file))
    throw hostedAdmissionError('mandatory task worker execution adapter configuration is missing');
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size > 65_536 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && stat.uid !== process.getuid() && stat.uid !== 0)
    )
      throw hostedAdmissionError(
        'worker execution configuration requires a private owner-controlled regular file',
      );
    return decodeHostedWorkerExecutionConfig(
      JSON.parse(readFileSync(fd, 'utf8')) as unknown,
      admission,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Hosted runtime admission refused:'))
      throw error;
    throw hostedAdmissionError('worker execution configuration is missing, unreadable or corrupt');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
