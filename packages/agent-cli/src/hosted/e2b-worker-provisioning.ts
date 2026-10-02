import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Sandbox } from 'e2b/dist/index.mjs';
import {
  decodeHostedIdentity,
  decodeHostedSnapshot,
  hostedAdmissionError,
  identifier,
  positiveInteger,
} from './hosted-runtime-config.js';
import { decodeHostedFilesystemCheckpoint } from './hosted-filesystem-checkpoint.js';
import { hostedSessionCheckpointBytes } from './hosted-session-checkpoint.js';
import type { IHostedWorkerResumeSession } from './hosted-worker-execution-config.js';
import type { IHostedIdentity, IHostedSnapshot } from './hosted-runtime-types.js';

/** Owner-side input. Sign admission only after this operation returns a verified resource receipt. */
export interface IE2BWorkerProvisioningOptions {
  readonly identity: IHostedIdentity;
  readonly epoch: number;
  readonly templateId: string;
  readonly apiKey: string;
  readonly brokerEndpoint: string;
  readonly lifetimeMs: number;
  readonly requestTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly snapshot: IHostedSnapshot | null;
  /** Owner-issued organization binding retained in the provider inventory across broker restarts. */
  readonly organization?: { readonly controlPlane: string; readonly grantId: string };
  /** Bytes fetched from the owner's checkpoint store; never an E2B memory snapshot/template. */
  readonly checkpoint?: Uint8Array;
}

export interface IE2BProvisionedWorker {
  readonly resource: string;
  readonly workspaceRoot: string;
  readonly operationId: string;
  readonly resumeSession?: IHostedWorkerResumeSession;
  readonly snapshot: IHostedSnapshot | null;
  release(): Promise<void>;
}

/** Reconciliation identifiers, without provider error text or credentials. */
export class E2BWorkerProvisioningError extends Error {
  constructor(
    readonly outcome: 'allocation-unknown' | 'cleanup-unresolved',
    readonly operationId: string,
    readonly resource?: string,
  ) {
    super(`E2B worker provisioning ${outcome}; owner reconciliation is required`);
    this.name = 'E2BWorkerProvisioningError';
  }
}

/** Create from a pinned clean baseline, restoring only bounded task files before issuing any authority. */
export async function provisionE2BTaskWorker(
  options: IE2BWorkerProvisioningOptions,
): Promise<IE2BProvisionedWorker> {
  const identity = decodeHostedIdentity(options.identity);
  const epoch = positiveInteger(options.epoch, 'worker epoch');
  const templateId = identifier(options.templateId, 'E2B clean template');
  const snapshot = decodeHostedSnapshot(options.snapshot);
  if ((snapshot === null) !== (options.checkpoint === undefined) || snapshot?.id === templateId)
    throw hostedAdmissionError('worker recovery requires checkpoint bytes and a separate clean template');
  const checkpoint = snapshot === null
    ? undefined
    : decodeHostedFilesystemCheckpoint(options.checkpoint!, snapshot, { identity, epoch });
  let broker: URL;
  try {
    broker = new URL(options.brokerEndpoint);
  } catch {
    throw hostedAdmissionError('worker broker endpoint is invalid');
  }
  if (
    (broker.protocol !== 'https:' && !(broker.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(broker.hostname))) ||
    broker.username || broker.password || broker.search || broker.hash
  )
    throw hostedAdmissionError('worker broker endpoint requires owner-selected TLS or literal loopback');
  const request = {
    apiKey: identifier(options.apiKey, 'E2B management credential'),
    requestTimeoutMs: positiveInteger(options.requestTimeoutMs, 'E2B request timeout', 30_000),
    apiUrl: 'https://api.e2b.app',
    sandboxUrl: 'https://sandbox.e2b.app',
    domain: 'e2b.app',
    debug: false,
    retries: 0,
  };
  const lifetimeMs = positiveInteger(options.lifetimeMs, 'E2B lifetime', 86_400_000);
  const operationId = randomUUID();
  const metadata = {
    ...identity,
    epoch: String(epoch),
    operationId,
    ...(options.organization === undefined ? {} : {
      organizationControlPlane: identifier(options.organization.controlPlane, 'organization control plane'),
      organizationGrant: identifier(options.organization.grantId, 'organization grant'),
    }),
    ...(snapshot === null ? {} : {
      restoreMode: 'filesystem-v1',
      checkpointId: snapshot.id,
      checkpointDigest: snapshot.digest,
      sourceWorker: checkpoint!.sourceWorker,
      sourceRuntime: checkpoint!.sourceRuntime,
      sourceEpoch: String(checkpoint!.sourceEpoch),
    }),
  };
  options.signal.throwIfAborted();
  let sandbox: Sandbox;
  try {
    // Do not abort away the allocation receipt. No authority is issued while allocation is pending.
    sandbox = await Sandbox.create(templateId, {
      ...request,
      timeoutMs: lifetimeMs,
      metadata,
      envs: {},
      allowInternetAccess: false,
      network: { allowPublicTraffic: false, allowOut: [broker.hostname] },
      lifecycle: { onTimeout: 'kill', autoResume: false },
    });
  } catch {
    throw new E2BWorkerProvisioningError('allocation-unknown', operationId);
  }
  let resource: string;
  try {
    resource = identifier(sandbox.sandboxId, 'allocated worker');
  } catch {
    throw new E2BWorkerProvisioningError('allocation-unknown', operationId);
  }
  let releasing: Promise<void> | undefined;
  const release = (): Promise<void> => {
    if (releasing === undefined)
      releasing = Sandbox.kill(resource, request).then(() => undefined).catch(() => {
        throw new E2BWorkerProvisioningError('cleanup-unresolved', operationId, resource);
      });
    return releasing;
  };
  try {
    const info = await Sandbox.getInfo(resource, request).catch(() => {
      throw new E2BWorkerProvisioningError('allocation-unknown', operationId, resource);
    });
    if (info.sandboxId !== resource || Object.entries(metadata).some(([key, value]) => info.metadata[key] !== value))
      throw new E2BWorkerProvisioningError('allocation-unknown', operationId, resource);
    if (resource === checkpoint?.sourceWorker)
      throw hostedAdmissionError('provider returned the checkpoint source instead of a fresh worker');
    if (
      info.templateId !== templateId || info.state !== 'running' ||
      info.lifecycle?.onTimeout !== 'kill' || info.lifecycle.autoResume !== false ||
      info.allowInternetAccess !== false || info.network?.allowPublicTraffic !== false ||
      JSON.stringify(info.network.allowOut ?? []) !== JSON.stringify([broker.hostname]) ||
      (info.volumeMounts?.length ?? 0) !== 0 || info.network.egressProxy !== undefined ||
      Object.keys(info.network.rules ?? {}).length !== 0
    )
      throw hostedAdmissionError('allocated worker ownership, clean template or network posture is invalid');
    options.signal.throwIfAborted();
    // An atomic new directory cannot inherit checkpoint symlinks or old user/authority state.
    const created = await sandbox.commands.run(`umask 077; mktemp -d "\${TMPDIR:-/tmp}/agent-task-${operationId}-XXXXXXXXXX"`, {
      cwd: '/', envs: {}, timeoutMs: options.requestTimeoutMs, requestTimeoutMs: options.requestTimeoutMs,
    });
    if (created.exitCode !== 0 || typeof created.stdout !== 'string')
      throw hostedAdmissionError('fresh worker workspace creation failed');
    const workspaceRoot = created.stdout.trim();
    if (
      !/^\/[A-Za-z0-9._/-]+$/u.test(workspaceRoot) ||
      posix.normalize(workspaceRoot) !== workspaceRoot ||
      !new RegExp(`^agent-task-${operationId}-[A-Za-z0-9]{10}$`, 'u').test(posix.basename(workspaceRoot))
    )
      throw hostedAdmissionError('fresh worker workspace receipt is invalid');
    for (const file of checkpoint?.files ?? []) {
      options.signal.throwIfAborted();
      const path = posix.join(workspaceRoot, file.path);
      await sandbox.files.write(path, file.bytes.slice().buffer as ArrayBuffer, {
        requestTimeoutMs: options.requestTimeoutMs,
      });
      const restored = await sandbox.files.read(path, { format: 'bytes', requestTimeoutMs: options.requestTimeoutMs });
      if (!Buffer.from(restored).equals(Buffer.from(file.bytes)))
        throw hostedAdmissionError('restored filesystem checkpoint bytes do not match');
    }
    let resumeSession: IHostedWorkerResumeSession | undefined;
    if (checkpoint?.session !== undefined) {
      options.signal.throwIfAborted();
      const session = { ...checkpoint.session, cwd: workspaceRoot };
      const bytes = hostedSessionCheckpointBytes(session);
      const path = posix.join(workspaceRoot, '.home', '.checkpoint-sessions', `${session.id}.json`);
      await sandbox.files.write(path, Uint8Array.from(bytes).buffer, { requestTimeoutMs: options.requestTimeoutMs });
      const restored = await sandbox.files.read(path, { format: 'bytes', requestTimeoutMs: options.requestTimeoutMs });
      if (!Buffer.from(restored).equals(bytes))
        throw hostedAdmissionError('restored conversation checkpoint bytes do not match');
      resumeSession = Object.freeze({ id: session.id, path, digest: createHash('sha256').update(bytes).digest('hex') });
    }
    options.signal.throwIfAborted();
    return Object.freeze({ resource, workspaceRoot, operationId, snapshot, release,
      ...(resumeSession === undefined ? {} : { resumeSession }),
    });
  } catch (error) {
    if (error instanceof E2BWorkerProvisioningError && error.outcome === 'allocation-unknown') throw error;
    await release();
    if (options.signal.aborted) options.signal.throwIfAborted();
    if (error instanceof Error && error.message.startsWith('Hosted runtime admission refused:')) throw error;
    throw hostedAdmissionError('fresh worker provisioning or filesystem restoration failed');
  }
}
