import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { resolveSelfForkWorkerEntry } from '../subagents/self-fork-worker-entry.js';

interface IHandshakeMessage {
  readonly kind: 'ready' | 'acknowledged' | 'error';
  readonly id: string;
  readonly code?: string;
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
    readonly onSpawn?: (child: ChildProcess) => void;
  } = {},
): Promise<string> {
  const self = resolveSelfForkWorkerEntry();
  const entryArgs = options.entrypoint ? [options.entrypoint] : self.args;
  const execArgs = options.execArgs ?? self.execArgv ?? [];
  const id = randomUUID();
  const child = spawn(self.execPath, [...execArgs, ...entryArgs, '--serve', '--supervised-session-id', id], {
    cwd,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: options.env ?? process.env,
  });
  try {
    options.onSpawn?.(child);
  } catch {
    await terminateFailedStart(child);
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
      if (message.kind === 'error') return fail('Supervised session refused to start.');
      if (message.kind === 'ready' && !ready) {
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
