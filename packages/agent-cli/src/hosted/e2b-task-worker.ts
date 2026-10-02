import { CommandExitError, Sandbox } from 'e2b/dist/index.mjs';
import { E2BSandboxClient } from '@robota-sdk/agent-tools';
import { hostedAdmissionError, identifier } from './hosted-runtime-config.js';
import { startE2BWorkerProcess } from './e2b-worker-process.js';
import type { IE2BWorkerProcess, IE2BWorkerProcessOptions } from './e2b-worker-process.js';
import type { IHostedAdmission } from './hosted-runtime-types.js';
import type { ISandboxClient } from '@robota-sdk/agent-tools';

/** Control-plane-only inputs. Neither the SDK credential nor its client enters a worker environment. */
export interface IE2BTaskWorkerOptions {
  readonly admission: IHostedAdmission;
  readonly templateId: string;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  /** Only the admitted company broker host may be added to the default closed egress policy. */
  readonly allowBrokerEgress?: boolean;
}

export interface IE2BOwnedTaskWorker {
  readonly client: ISandboxClient;
  startProcess(options: IE2BWorkerProcessOptions): Promise<IE2BWorkerProcess>;
  /** Withdraw access immediately, then delete the admitted task's provider resource. */
  release(): Promise<void>;
}

/** Connect only the admitted resource after checking its operator-provisioned ownership and network posture. */
export async function connectE2BTaskWorker(
  options: IE2BTaskWorkerOptions,
): Promise<IE2BOwnedTaskWorker> {
  const { admission, signal } = options;
  const rootTask = admission.config.identity.rootTask;
  const templateId = identifier(options.templateId, 'E2B template');
  const sandboxId = admission.config.worker.resource;
  signal.throwIfAborted();
  if (admission.expiresAt <= Date.now()) throw hostedAdmissionError('E2B worker admission expired');
  const request = {
    apiKey: identifier(options.apiKey, 'E2B management credential'),
    requestTimeoutMs: admission.config.probeTimeoutMs,
    apiUrl: 'https://api.e2b.app',
    sandboxUrl: 'https://sandbox.e2b.app',
    domain: 'e2b.app',
    debug: false,
    retries: 0,
  };
  const info = await Sandbox.getInfo(sandboxId, { ...request, signal }).catch(() => {
    throw hostedAdmissionError('E2B worker metadata is unavailable');
  });
  const ownership = {
    tenant: admission.config.identity.tenant,
    task: admission.config.identity.task,
    actor: admission.config.identity.actor,
    runtime: admission.config.identity.runtime,
    rootTask,
  };
  const allowedOut =
    options.allowBrokerEgress === true ? [new URL(admission.config.broker.endpoint).hostname] : [];
  const snapshot = admission.config.snapshot;
  if (info.state !== 'running')
    throw hostedAdmissionError('E2B task worker must already be running; memory resume is refused');
  if (info.lifecycle?.onTimeout !== 'kill' || info.lifecycle.autoResume !== false)
    throw hostedAdmissionError('E2B worker lifecycle must kill on timeout without auto-resume');
  if (snapshot !== null && (
    info.metadata.restoreMode !== 'filesystem-v1' ||
    info.metadata.checkpointId !== snapshot.id ||
    info.metadata.checkpointDigest !== snapshot.digest ||
    info.metadata.epoch !== String(admission.config.epoch) ||
    !/^[1-9][0-9]*$/u.test(info.metadata.sourceEpoch ?? '') ||
    !Number.isSafeInteger(Number(info.metadata.sourceEpoch)) ||
    Number(info.metadata.sourceEpoch) >= admission.config.epoch ||
    !info.metadata.sourceWorker || info.metadata.sourceWorker === sandboxId ||
    !info.metadata.sourceRuntime || info.metadata.sourceRuntime === admission.config.identity.runtime
  )) {
    throw hostedAdmissionError('E2B checkpoint requires an owner-validated fresh filesystem worker');
  }
  if (
    info.sandboxId !== sandboxId ||
    info.templateId !== templateId ||
    Object.entries(ownership).some(([key, value]) => info.metadata[key] !== value) ||
    info.allowInternetAccess !== false ||
    info.network?.allowPublicTraffic !== false ||
    JSON.stringify([...(info.network.allowOut ?? [])].sort()) !==
      JSON.stringify(allowedOut.sort()) ||
    (info.volumeMounts?.length ?? 0) > 0 ||
    info.network.egressProxy !== undefined ||
    Object.keys(info.network.rules ?? {}).length > 0
  ) {
    throw hostedAdmissionError(
      'E2B worker ownership, template or provider network configuration does not match',
    );
  }
  let closed = false;
  let connecting = false;
  let connectionOutcomeUnknown = false;
  let connectionSettled!: () => void;
  const connectionSettlement = new Promise<void>((resolve) => {
    connectionSettled = resolve;
  });
  let releasing: Promise<void> | undefined;
  const release = (): Promise<void> => {
    closed = true;
    signal.removeEventListener('abort', onAbort);
    if (releasing === undefined) {
      const finishPendingConnection = connecting;
      releasing = (async () => {
        try {
          await Sandbox.kill(sandboxId, request);
        } catch {
          if (!finishPendingConnection)
            throw hostedAdmissionError('E2B provider cleanup is unresolved');
        }
        if (finishPendingConnection) {
          // connect resumes a paused resource: an earlier kill cannot settle that mutation.
          await connectionSettlement;
          await Sandbox.kill(sandboxId, request).catch(() => {
            throw hostedAdmissionError('E2B provider cleanup is unresolved');
          });
        }
      })();
    }
    return releasing;
  };
  const onAbort = (): void => {
    void release().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const assertOpen = (): void => {
    if (closed) throw hostedAdmissionError('E2B task worker has been released');
    signal.throwIfAborted();
  };
  try {
    assertOpen();
    if (admission.expiresAt <= Date.now())
      throw hostedAdmissionError('E2B worker admission expired');
    connecting = true;
    let sandbox: Sandbox;
    try {
      // Caller abort withdraws access, but must not cancel the receipt of a provider resume.
      sandbox = await Sandbox.connect(sandboxId, request);
    } catch {
      connectionOutcomeUnknown = true;
      throw hostedAdmissionError('E2B task worker connection failed');
    } finally {
      connecting = false;
      connectionSettled();
    }
    if (sandbox.sandboxId !== sandboxId)
      throw hostedAdmissionError('E2B connector returned another task resource');
    signal.throwIfAborted();
    if (admission.expiresAt <= Date.now())
      throw hostedAdmissionError('E2B worker admission expired');
    const client = new E2BSandboxClient({
      sandbox: {
        sandboxId,
        commands: {
          run: async (command, commandOptions) => {
            assertOpen();
            try {
              const result = await sandbox.commands.run(command, { ...commandOptions, signal });
              assertOpen();
              return result;
            } catch (error) {
              // A known nonzero completion is a receipt, not an unknown transport failure.
              assertOpen();
              if (error instanceof CommandExitError) {
                return { stdout: error.stdout, stderr: error.stderr, exitCode: error.exitCode };
              }
              throw hostedAdmissionError('E2B command outcome is unknown');
            }
          },
        },
        files: {
          read: async (path) => {
            assertOpen();
            const result = await sandbox.files.read(path, { signal }).catch(() => {
              assertOpen();
              throw hostedAdmissionError('E2B file read failed');
            });
            assertOpen();
            return result;
          },
          write: async (path, contents) => {
            assertOpen();
            await sandbox.files.write(path, contents, { signal }).catch(() => {
              assertOpen();
              throw hostedAdmissionError('E2B file write outcome is unknown');
            });
            assertOpen();
          },
        },
      },
    });
    return {
      client,
      startProcess: (processOptions) => startE2BWorkerProcess(sandbox, processOptions, assertOpen),
      release,
    };
  } catch (error) {
    try {
      await release();
    } catch {
      throw hostedAdmissionError(
        'E2B task worker connection failed and provider cleanup is unresolved',
      );
    }
    if (connectionOutcomeUnknown)
      throw hostedAdmissionError(
        'E2B worker connection outcome is unknown; provider cleanup remains unresolved',
      );
    if (
      error instanceof Error &&
      error.message === 'Hosted runtime admission refused: E2B worker admission expired'
    )
      throw error;
    throw hostedAdmissionError('E2B task worker connection failed');
  }
}
