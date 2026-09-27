import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { resolveSelfForkWorkerEntry } from '../subagents/self-fork-worker-entry.js';
import { RESTRICTED_WORKSPACE_FLAG } from '../startup/workspace-project-composition.js';
import {
  discardSupervisedGrantHandoff,
  isSupervisedSessionName,
  resolveSupervisedDirectory,
  SupervisedControlPathTooLongError,
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
  /** On a `control-path-too-long` error: the supervised directory the socket did not fit under. */
  readonly directory?: unknown;
}

const GRANT_ID = /^[a-zA-Z0-9_-]{1,64}$/u;
const MAX_DIRECTORY_BYTES = 4_096;
const DIRECTORY_CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** A directory the child reports is printed to the owner, so it must be a plain absolute path. */
function isReportedDirectory(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && !DIRECTORY_CONTROLS.test(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_DIRECTORY_BYTES;
}

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

/**
 * Issue #3282 §3: the tail of what the child wrote to stderr before it died — the real reason (e.g.
 * "No provider configuration found...", before setup mode existed to avoid it entirely; still the
 * reason for anything else that kills the child early), where a plain "the readiness channel closed"
 * or "the process exited" said nothing a caller — `robota daemon start --json`, the desktop fatal
 * screen — could act on. Bounded so one runaway child cannot grow this without limit.
 */
const STDERR_TAIL_LIMIT = 4_000;

function trackStderrTail(child: ChildProcess): () => string {
  let tail = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    tail = (tail + String(chunk)).slice(-STDERR_TAIL_LIMIT);
  });
  return () => tail.trim();
}

/**
 * `exit`/`disconnect` can fire before a piped stream's last `data` event is delivered — Node's own
 * documented reason `close` exists. A brief, bounded wait for the stream to actually end (never the
 * full 20s readiness budget) makes "the child wrote a reason right before dying" land reliably
 * without switching the failure signal itself to `close` (which can arrive later still, and this
 * function's callers need to fail promptly either way).
 */
function stderrFlushed(child: ChildProcess): Promise<void> {
  const stderr = child.stderr;
  if (!stderr || stderr.readableEnded || stderr.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stderr.once('end', done);
    stderr.once('close', done);
    setTimeout(done, 200);
  });
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
    /** Start it Restricted: a person chose to run this untrusted folder without its own configuration. */
    readonly restricted?: boolean;
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
      ...(options.restricted === true ? [RESTRICTED_WORKSPACE_FLAG] : []),
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
      // #3282 §3: stderr is piped (was 'ignore') so a death before readiness can report why —
      // otherwise discarded exactly as before, and released on every exit path below.
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: options.env ?? process.env,
    });
  } catch (error) {
    discardHandoff();
    throw error;
  }
  const readStderrTail = trackStderrTail(child);
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
    const timer = setTimeout(
      () => failFromChild('Supervised session did not become ready in time.'),
      20_000,
    );
    const finish = (result: { ok: true } | { ok: false; message: string }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stderr?.destroy();
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
    // #3282 §3: these three are generic — "something killed the child before it said why". The
    // child's own stderr tail, when it wrote one, IS why; a fallback text stands in only when it
    // wrote nothing. The handshake's own structured errors below already know their own precise
    // reason and are never replaced by incidental stderr output.
    const failFromChild = (fallback: string): void => {
      void stderrFlushed(child).then(() => {
        const said = readStderrTail();
        fail(said.length > 0 ? said : fallback);
      });
    };
    child.once('error', () => failFromChild('Supervised session process could not start.'));
    child.once('exit', () => failFromChild('Supervised session process exited before it was ready.'));
    child.once('disconnect', () =>
      failFromChild('Supervised session readiness channel closed before acknowledgement.'),
    );
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
              : message.code === 'control-path-too-long' && isReportedDirectory(message.directory)
                ? new SupervisedControlPathTooLongError(message.directory).message
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
