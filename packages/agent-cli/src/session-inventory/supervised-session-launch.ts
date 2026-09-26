import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { resolveSelfForkWorkerEntry } from '../subagents/self-fork-worker-entry.js';
import {
  discardSupervisedGrantHandoff,
  isSupervisedSessionName,
  resolveSupervisedDirectory,
  writeSupervisedGrantHandoff,
} from './supervised-session-control.js';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';

interface IHandshakeMessage {
  readonly kind: 'ready' | 'acknowledged' | 'error';
  readonly id: string;
  readonly code?: string;
  /** On `ready`: the labels of the grants the child opened. On a `grant-refused` error: the one refused. */
  readonly grants?: unknown;
  readonly grant?: unknown;
}

const GRANT_ID = /^[a-zA-Z0-9_-]{1,64}$/u;

/** The child opened exactly the grants it was handed: none lost, none added. */
function sameGrants(reported: unknown, sent: readonly string[]): boolean {
  if (reported === undefined) return sent.length === 0;
  if (!Array.isArray(reported) || reported.length !== sent.length) return false;
  const expected = [...sent].sort();
  return [...reported].sort().every((grantId, index) => grantId === expected[index]);
}

function isHandshakeMessage(value: unknown, id: string): value is IHandshakeMessage {
  return typeof value === 'object' && value !== null &&
    'kind' in value && 'id' in value && value.id === id &&
    (value.kind === 'ready' || value.kind === 'acknowledged' || value.kind === 'error');
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return true;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onExit = (): void => finish(true);
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    child.once('exit', onExit);
  });
}

/** A refused start never leaves a detached runtime running without an owner. */
async function terminateFailedStart(child: ChildProcess): Promise<boolean> {
  if (child.pid === undefined) {
    if (child.connected) {
      try { child.disconnect(); } catch { /* no process was created */ }
    }
    child.unref();
    return true;
  }
  if (!hasExited(child)) {
    try { child.kill('SIGTERM'); } catch { /* spawn may have failed before a PID existed */ }
    if (!(await waitForExit(child, 2_000))) {
      try { child.kill('SIGKILL'); } catch { /* exit or spawn failure raced the signal */ }
      await waitForExit(child, 2_000);
    }
  }
  if (child.connected) {
    try { child.disconnect(); } catch { /* already disconnected */ }
  }
  child.unref();
  return hasExited(child);
}

/** Start one opt-in supervised runtime without sending credentials through the control channel. */
export async function launchSupervisedSession(
  cwd: string,
  options: {
    readonly entrypoint?: string;
    readonly execArgs?: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
    readonly name?: string;
    readonly onSpawn?: (child: ChildProcess) => void;
    /** Validated external-event grants the child must open before it reports ready. */
    readonly grants?: readonly IExternalEventGrant[];
    /** Where the child's external-event endpoint listens; required with grants. */
    readonly eventEndpoint?: { readonly port: number; readonly trustedProxies?: readonly string[] };
    readonly root?: string;
    /**
     * Start this workspace's daemon: its control hands the owner the WebSocket URL. The caller
     * puts the transport token in `env`, never on the command line.
     */
    readonly daemon?: boolean;
  } = {},
): Promise<string> {
  if (options.name !== undefined && !isSupervisedSessionName(options.name)) {
    throw new Error('Supervised session name is invalid or too long.');
  }
  const grants = options.grants ?? [];
  if (grants.length > 0 && options.eventEndpoint === undefined) {
    throw new Error('External event grants need the port their endpoint listens on.');
  }
  const sentGrantIds = grants.map((grant) => grant.grantId);
  const root = grants.length > 0 ? (options.root ?? resolveSupervisedDirectory()) : undefined;
  const self = resolveSelfForkWorkerEntry();
  const entryArgs = options.entrypoint ? [options.entrypoint] : self.args;
  const execArgs = options.execArgs ?? self.execArgv ?? [];
  const id = randomUUID();
  const discardHandoff = (): void => {
    if (root !== undefined) discardSupervisedGrantHandoff(root, id);
  };
  if (root !== undefined) writeSupervisedGrantHandoff(root, id, grants);
  let child: ChildProcess;
  try {
    child = spawn(self.execPath, [
      ...execArgs, ...entryArgs, '--serve', '--supervised-session-id', id,
      ...(options.name === undefined ? [] : [`--name=${options.name}`]),
      ...(grants.length > 0 ? ['--supervised-external-event-grants'] : []),
      ...(options.daemon === true ? ['--daemon'] : []),
      ...(grants.length > 0 && options.eventEndpoint !== undefined
        ? [
            `--external-event-port=${options.eventEndpoint.port}`,
            ...(options.eventEndpoint.trustedProxies ?? []).map(
              (proxy) => `--external-event-trusted-proxy=${proxy}`,
            ),
          ]
        : []),
    ], {
      cwd,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: options.env ?? process.env,
    });
  } catch (error) {
    discardHandoff();
    throw error;
  }
  try {
    options.onSpawn?.(child);
  } catch {
    await terminateFailedStart(child);
    discardHandoff();
    throw new Error('Supervised session launch observer failed.');
  }

  return new Promise<string>((resolve, reject) => {
    let done = false;
    let ready = false;
    const timer = setTimeout(() => fail('Supervised session did not become ready in time.'), 20_000);
    const finish = (result: { ok: true } | { ok: false; message: string }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (result.ok) {
        try {
          child.disconnect();
          child.unref();
          resolve(id);
        } catch {
          void terminateFailedStart(child).then(() => reject(new Error('Supervised session could not detach.')));
        }
      } else {
        // A child that never read its grants must not leave them behind.
        discardHandoff();
        void terminateFailedStart(child).then((exited) => {
          reject(new Error(exited ? result.message : `${result.message} Process exit could not be confirmed.`));
        });
      }
    };
    const fail = (message: string): void => finish({ ok: false, message });
    child.once('error', () => fail('Supervised session process could not start.'));
    child.once('exit', () => fail('Supervised session process exited before it was ready.'));
    child.once('disconnect', () => fail('Supervised session readiness channel closed before acknowledgement.'));
    child.on('message', (message: unknown) => {
      if (!isHandshakeMessage(message, id)) return fail('Supervised session sent an invalid readiness message.');
      if (message.kind === 'error') {
        return fail(message.code === 'grant-refused' && typeof message.grant === 'string' &&
          GRANT_ID.test(message.grant) && sentGrantIds.includes(message.grant)
          ? `grant ${message.grant}: refused by the session.`
          : message.code === 'events-endpoint-failed'
            ? 'External event endpoint could not be served on its port.'
            : message.code === 'daemon-no-endpoint'
              ? 'The daemon has no WebSocket endpoint; enable the ws transport.'
              : 'Supervised session refused to start.');
      }
      if (message.kind === 'ready' && !ready) {
        if (!sameGrants(message.grants, sentGrantIds)) {
          return fail('Supervised session did not open exactly the external event grants it was given.');
        }
        ready = true;
        child.send({ kind: 'ack', id }, (error) => {
          if (error) fail('Supervised session acknowledgement failed.');
        });
        return;
      }
      if (message.kind === 'acknowledged' && ready) finish({ ok: true });
      else fail('Supervised session sent an out-of-order readiness message.');
    });
  });
}
