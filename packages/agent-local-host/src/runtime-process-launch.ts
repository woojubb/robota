/**
 * Starting a runtime process and waiting until it says it is ready: the handshake with the child over
 * its ipc channel, its stderr tail, the pipes a transport token and a spawner pair travel on, a
 * forwarded descriptor, and ending a start that failed. It knows no product: the command, the
 * argument layout, the token names, the refusal copy and the grant handoff come in through the
 * request, so the product's flags, variables, paths and wording stay with the caller.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { closeSync, fstatSync } from 'node:fs';
import { Duplex, Writable } from 'node:stream';
import { completeSpawnerPair, type ISpawnerPairResult } from '@robota-sdk/agent-transport/link';

import { scrubSecrets } from '@robota-sdk/agent-core';
import { withChildSession } from '@robota-sdk/agent-core/node';

import { SupervisedControlPathTooLongError } from './supervised-control-carrier.js';
import { isSupervisedTransportToken, SUPERVISED_TRANSPORT_TOKEN_FD } from './supervised-transport-token.js';

/** What a runtime process receives on its private channel: the whole admitted environment, no more. */
export const MAX_FORWARDED_ENVIRONMENT_BYTES = 128 * 1024;

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

const REFUSED = 'Supervised session refused to start.';

/**
 * The reason a runtime gave for refusing to start. The layout words the refusals it has copy for;
 * a grant counts only when it is one this launch handed over, a directory only when it is a plain path.
 */
function refusalMessage(message: IHandshakeMessage, sentGrantIds: readonly string[], layout: IRuntimeStartLayout): string {
  if (message.code === 'grant-refused' && typeof message.grant === 'string' &&
    GRANT_ID.test(message.grant) && sentGrantIds.includes(message.grant)) {
    return layout.refusalText?.(message.code, { grant: message.grant }) ?? REFUSED;
  }
  if (message.code === 'events-endpoint-failed' || message.code === 'daemon-no-endpoint') {
    return layout.refusalText?.(message.code, {}) ?? REFUSED;
  }
  if (message.code === 'control-path-too-long' && isReportedDirectory(message.directory)) {
    return new SupervisedControlPathTooLongError(message.directory).message;
  }
  return REFUSED;
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
 * The tail of what the child wrote to stderr before it died — the real reason it was killed early,
 * where a plain "the readiness channel closed" or "the process exited" said nothing a caller — one
 * that prints structured output, or one that shows a fatal-error screen — could act on. Bounded so
 * one runaway child cannot grow this without limit.
 */
const STDERR_TAIL_LIMIT = 4_000;
/** Keeps the reported message readable — the failing line is almost always near the end. */
const STDERR_TAIL_MAX_LINES = 20;

function trackStderrTail(child: ChildProcess): { read: () => string; stop: () => void } {
  let tail = '';
  const onData = (chunk: Buffer | string): void => {
    tail = (tail + String(chunk)).slice(-STDERR_TAIL_LIMIT);
  };
  child.stderr?.on('data', onData);
  return {
    read: () => tail,
    stop: () => { child.stderr?.off('data', onData); },
  };
}

/** A complete ANSI CSI sequence (color/cursor codes) or OSC sequence (titles/hyperlinks). */
// eslint-disable-next-line no-control-regex -- matching control bytes IS the point: stripping them.
const ANSI_SEQUENCE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu;
/** Any remaining control character except tab and newline — including a lone, unmatched ESC. */
// eslint-disable-next-line no-control-regex -- matching control bytes IS the point: stripping them.
const STRAY_CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F]/gu;

/** (a) Strip ANSI escapes and control characters, keeping newline and tab — see `sanitizeStderrTail`. */
function stripAnsiAndControlChars(text: string): string {
  return text.replace(ANSI_SEQUENCE, '').replace(STRAY_CONTROL_CHARS, '');
}

/**
 * (b) Exact-value redaction: this process handed the child its own env, so anything shaped like a
 * credential in there (name matches, value long enough to not be a false positive on something like
 * a short flag) is replaced everywhere it appears verbatim, as is every secret handed over outside
 * the env (the transport token's pipe). `split`/`join`, not a constructed RegExp: a credential value
 * routinely contains characters (`+`, `/`, `=`, …) that would need escaping first.
 */
const CREDENTIAL_ENV_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/iu;
const MIN_CREDENTIAL_VALUE_LENGTH = 8;

function redactEnvCredentialValues(
  text: string,
  env: NodeJS.ProcessEnv,
  handedOverSecrets: readonly string[],
): string {
  let result = text;
  const secrets = [
    ...Object.entries(env)
      .filter(([name]) => CREDENTIAL_ENV_NAME.test(name))
      .map(([, value]) => value)
      .filter((value): value is string => value !== undefined && value.length >= MIN_CREDENTIAL_VALUE_LENGTH),
    ...handedOverSecrets,
  ].map(stripAnsiAndControlChars).filter((value) => value.length > 0).sort((a, b) => b.length - a.length);
  for (const value of secrets) {
    if (!result.includes(value)) continue;
    result = result.split(value).join('[REDACTED]');
  }
  return result;
}

/** (d) The failure is almost always in the last few lines; a long stack trace should not crowd it out. */
function lastLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  return lines.length <= maxLines ? text : lines.slice(-maxLines).join('\n');
}

/**
 * Before a captured stderr tail leaves this process (a caller's structured output or its fatal-error
 * screen) it is never shown raw: (a) ANSI/control characters, (b) this process's own env-credential
 * values, and (c) `scrubSecrets`'s known secret patterns (agent-core) are stripped, in that order, then
 * (d) only the last ~20 lines are kept. The child inherits this process's full environment, so (a)+(b)
 * alone cover a value it never should have echoed; (c) catches a secret the child saw over the wire
 * (an API response, a `Bearer` header) that was never this process's own to redact by value. A secret
 * handed over outside the env (`handedOverSecrets`) is no longer in it, so (b) takes it explicitly.
 */
function sanitizeStderrTail(
  raw: string,
  env: NodeJS.ProcessEnv,
  handedOverSecrets: readonly string[] = [],
): string {
  const withoutAnsi = stripAnsiAndControlChars(raw);
  const withoutEnvSecrets = redactEnvCredentialValues(withoutAnsi, env, handedOverSecrets);
  const withoutKnownPatterns = scrubSecrets(withoutEnvSecrets);
  return lastLines(withoutKnownPatterns.trim(), STDERR_TAIL_MAX_LINES).trim();
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

/** The environment minus the transport token's names, matched case-insensitively as Windows does. */
function withoutTransportTokenNames(env: NodeJS.ProcessEnv, tokenNames: readonly string[]): NodeJS.ProcessEnv {
  const names = new Set(tokenNames.map((name) => name.toUpperCase()));
  return Object.fromEntries(Object.entries(env).filter(([name]) => !names.has(name.toUpperCase())));
}

/** How a runtime process is started: the executable, the flags it runs under, and the entry it runs. */
export interface IRuntimeStartCommand {
  readonly executable: string;
  readonly execArgs: readonly string[];
  readonly entryArgs: readonly string[];
}

/** What the launcher knows about one start; the layout turns it into the arguments the runtime reads. */
export interface IRuntimeStartFacts {
  readonly id: string;
  readonly name?: string;
  readonly daemon: boolean;
  readonly restricted: boolean;
  /** The transport token travels over the extra inherited pipe. */
  readonly transportToken: boolean;
  /** The runtime receives a spawner pair on the extra inherited descriptor. */
  readonly spawnerPair: boolean;
  /** The runtime asks for its admitted environment over the readiness channel. */
  readonly forwardedEnvironment: boolean;
  /** The runtime reads its grants from the handoff. */
  readonly handoff: boolean;
}

/** The caller's side of a start: the runtime's argument layout, token names and refusal copy. */
export interface IRuntimeStartLayout {
  /** Every argument after the command's own, in the order the runtime reads them. */
  arguments(facts: IRuntimeStartFacts): readonly string[];
  /** Names the runtime reads a transport token from; removed from its environment whenever the token travels another way. */
  readonly transportTokenNames: readonly string[];
  /** Copy for a refusal the runtime reports by code; undefined for a code it has no copy for. */
  refusalText?(code: string, detail: { readonly grant?: string }): string | undefined;
}

/** Grants a starting runtime must open, handed to it outside its arguments and its environment. */
export interface IRuntimeStartHandoff {
  /** The labels of the grants handed over; the runtime must report exactly these as opened. */
  readonly labels: readonly string[];
  /** Throws when the handoff cannot be served; runs before anything is written or spawned. */
  check(): void;
  write(id: string): void;
  discard(id: string): void;
}

export interface IRuntimeStartRequest {
  readonly command: IRuntimeStartCommand;
  readonly layout: IRuntimeStartLayout;
  /** The environment the runtime inherits, before the transport token's names are removed from it. */
  readonly environment: NodeJS.ProcessEnv;
  readonly name?: string;
  readonly daemon?: boolean;
  readonly restricted?: boolean;
  /** 64 lowercase hex characters; it reaches the runtime only over an extra inherited pipe. */
  readonly transportToken?: string;
  readonly handoff?: IRuntimeStartHandoff;
  /** The caller's own rules for what it asked to start; runs before any check of the launcher's. */
  readonly validate?: () => void;
  readonly onSpawn?: (child: ChildProcess) => void;
}

export type TPreparedForwardedEnvironment = { readonly environment: NodeJS.ProcessEnv; readonly availableCredentialNames: readonly string[] };
type TLaunchMode = { readonly kind: 'plain' } | { readonly kind: 'spawner'; readonly pairTimeoutMs?: number } | { readonly kind: 'forwarded'; readonly spawnerFd: number; readonly closeParent: () => void; readonly prepareEnvironment?: () => Promise<TPreparedForwardedEnvironment> };
type TLaunchResult = { readonly kind: 'plain' | 'forwarded'; readonly id: string } | ({ readonly kind: 'spawner'; readonly id: string } & ISpawnerPairResult);

/** Start one runtime without sending credentials through the control channel. */
export async function startPlainRuntime(cwd: string, request: IRuntimeStartRequest): Promise<string> {
  const result = await launchRuntime(cwd, request, { kind: 'plain' });
  return result.id;
}

/** Start a secure runtime and receive its spawner key over the inherited pair before readiness. */
export async function startSpawnerRuntime(
  cwd: string,
  request: IRuntimeStartRequest,
  options: { readonly pairTimeoutMs?: number } = {},
): Promise<{ readonly id: string } & ISpawnerPairResult> {
  const result = await launchRuntime(cwd, request, {
    kind: 'spawner',
    ...(options.pairTimeoutMs === undefined ? {} : { pairTimeoutMs: options.pairTimeoutMs }),
  });
  if (result.kind !== 'spawner') throw new Error('The secure runtime did not complete its spawner exchange.');
  return result;
}

/** Forward a spawner's pair, inherited from the process that started this one, without reading or certifying it. */
export async function startForwardedRuntime(
  cwd: string,
  request: IRuntimeStartRequest,
  forwarded: { readonly spawnerFd: number; readonly prepareEnvironment?: () => Promise<TPreparedForwardedEnvironment> },
): Promise<string> {
  const fd = forwarded.spawnerFd;
  if (!Number.isSafeInteger(fd) || fd < 3) throw new Error('The spawner descriptor is invalid.');
  if (process.platform !== 'win32') {
    let isSocket = false;
    try { isSocket = fstatSync(fd, { bigint: true }).isSocket(); } catch { /* Not a live descriptor. */ }
    if (!isSocket) throw new Error('The spawner descriptor is not a handed-over pair.');
  }
  let owned = true;
  const closeParent = (): void => {
    if (!owned) return;
    owned = false;
    try { closeSync(fd); } catch { /* The descriptor is already closed. */ }
  };
  try {
    const result = await launchRuntime(cwd, request, { kind: 'forwarded', spawnerFd: fd, closeParent, ...(forwarded.prepareEnvironment === undefined ? {} : { prepareEnvironment: forwarded.prepareEnvironment }) });
    return result.id;
  } finally {
    closeParent();
  }
}

async function launchRuntime(
  cwd: string,
  request: IRuntimeStartRequest,
  mode: TLaunchMode,
): Promise<TLaunchResult> {
  request.validate?.();
  const transportToken = request.transportToken;
  const handoff = request.handoff;
  if (mode.kind !== 'plain' && (transportToken !== undefined || request.daemon === true || handoff !== undefined)) {
    throw new Error('A secure runtime cannot start with a plain token, daemon flag or external grants.');
  }
  if (transportToken !== undefined && !isSupervisedTransportToken(transportToken)) {
    throw new Error('Supervised session transport token is invalid.');
  }
  handoff?.check();
  const sentGrantIds = handoff?.labels ?? [];
  const { command, layout } = request;
  const id = randomUUID();
  const discardHandoff = (): void => {
    handoff?.discard(id);
  };
  handoff?.write(id);
  // The same env handed to the child — reused to redact its own credential values out of
  // whatever the child echoes back on stderr, in `sanitizeStderrTail`.
  const inheritedEnv = request.environment;
  const childEnv = transportToken === undefined && mode.kind === 'plain'
    ? inheritedEnv
    : withoutTransportTokenNames(inheritedEnv, layout.transportTokenNames);
  let child: ChildProcess;
  try {
    child = spawn(command.executable, [
      ...command.execArgs, ...command.entryArgs,
      ...layout.arguments({
        id,
        ...(request.name === undefined ? {} : { name: request.name }),
        daemon: request.daemon === true,
        restricted: request.restricted === true,
        transportToken: transportToken !== undefined,
        spawnerPair: mode.kind !== 'plain',
        forwardedEnvironment: mode.kind === 'forwarded' && mode.prepareEnvironment !== undefined,
        handoff: handoff !== undefined,
      }),
    // The runtime outlives this launcher by design, in its own session in both modes, so it is not
    // registered to end with this process.
    ], withChildSession({
      cwd,
      detached: true,
      // Stderr is piped (was 'ignore') so a death before readiness can report why —
      // otherwise discarded exactly as before, and released on every exit path below.
      // The transport token's pipe, when there is one, is the child's descriptor 4.
      stdio: ['ignore', 'ignore', 'pipe', 'ipc', ...(mode.kind === 'forwarded' ? [mode.spawnerFd] : transportToken === undefined && mode.kind === 'plain' ? [] : ['pipe' as const])],
      env: childEnv,
    }));
  } catch (error) {
    discardHandoff();
    throw error;
  } finally {
    if (mode.kind === 'forwarded') mode.closeParent();
  }
  const stderrTail = trackStderrTail(child);
  try {
    request.onSpawn?.(child);
  } catch {
    await terminateFailedStart(child);
    discardHandoff();
    throw new Error('Supervised session launch observer failed.');
  }

  const tokenPipe = transportToken === undefined ? undefined : child.stdio[SUPERVISED_TRANSPORT_TOKEN_FD];
  const handedOverSecrets = [
    ...(transportToken === undefined ? [] : [transportToken]),
    ...(mode.kind === 'spawner' ? Object.values(childEnv).filter((value): value is string => value !== undefined) : []),
  ];
  const pairPipe = mode.kind === 'spawner' ? child.stdio[SUPERVISED_TRANSPORT_TOKEN_FD] : undefined;

  return new Promise<TLaunchResult>((resolve, reject) => {
    let done = false;
    let ready = false;
    let acknowledged = false;
    let pair: ISpawnerPairResult | undefined;
    let admissionRequested = false;
    let admissionSent = false;
    const timer = setTimeout(
      () => failFromChild('Supervised session did not become ready in time.'),
      20_000,
    );
    const finish = (result: { ok: true } | { ok: false; message: string }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (result.ok) {
        stderrTail.stop();
        // Keep the pipe readable while this launcher lives, but do not keep a detached launcher's
        // event loop open. Closing its read end here makes a later host error an EPIPE.
        child.stderr?.resume();
        if (child.stderr !== null && child.stderr !== undefined &&
          'unref' in child.stderr && typeof child.stderr.unref === 'function') {
          child.stderr.unref();
        }
        try {
          child.disconnect();
          child.unref();
          if (mode.kind !== 'spawner') resolve({ kind: mode.kind, id });
          else if (pair !== undefined) resolve({ kind: 'spawner', id, ...pair });
          else reject(new Error('The secure runtime did not complete its spawner exchange.'));
        } catch {
          pair?.spawnerKey.wipe();
          void terminateFailedStart(child).then(() => reject(new Error('Supervised session could not detach.')));
        }
      } else {
        child.stderr?.destroy();
        if (tokenPipe instanceof Writable) tokenPipe.destroy();
        if (pairPipe instanceof Duplex) pairPipe.destroy();
        pair?.spawnerKey.wipe();
        // A child that never read its grants must not leave them behind.
        discardHandoff();
        void terminateFailedStart(child).then((exited) => {
          reject(new Error(exited ? result.message : `${result.message} Process exit could not be confirmed.`));
        });
      }
    };
    const fail = (message: string): void => finish({ ok: false, message });
    const finishWhenReady = (): void => {
      if (acknowledged && (mode.kind !== 'spawner' || pair !== undefined)) finish({ ok: true });
    };
    if (mode.kind === 'spawner') {
      if (!(pairPipe instanceof Duplex)) fail('Supervised session could not receive its spawner pair.');
      else {
        void completeSpawnerPair(pairPipe, mode.pairTimeoutMs === undefined ? {} : { timeoutMs: mode.pairTimeoutMs }).then(
          (completed) => {
            if (done) { completed.spawnerKey.wipe(); return; }
            pair = completed;
            finishWhenReady();
          },
          () => fail('Supervised session could not complete its spawner exchange.'),
        );
      }
    }
    // These three are generic — "something killed the child before it said why". The
    // child's own stderr tail, when it wrote one, IS why; a fallback text stands in only when it
    // wrote nothing. The handshake's own structured errors below already know their own precise
    // reason and are never replaced by incidental stderr output.
    const failFromChild = (fallback: string): void => {
      void stderrFlushed(child).then(() => {
        const said = sanitizeStderrTail(stderrTail.read(), childEnv, handedOverSecrets);
        fail(said.length > 0 ? said : fallback);
      });
    };
    child.once('error', () => failFromChild('Supervised session process could not start.'));
    child.once('exit', () => failFromChild('Supervised session process exited before it was ready.'));
    child.once('disconnect', () =>
      failFromChild('Supervised session readiness channel closed before acknowledgement.'),
    );
    if (transportToken !== undefined) {
      // Written and closed at once: the child reads it first thing, before it can report ready. A pipe
      // that cannot take it (the child already gone, no pipe at all) fails the start like any other
      // early death, with the child's own stderr as the reason when it wrote one.
      const refused = (): void => failFromChild('Supervised session could not receive its transport token.');
      if (tokenPipe instanceof Writable) {
        tokenPipe.on('error', refused);
        tokenPipe.end(transportToken);
      } else {
        refused();
      }
    }
    child.on('message', (message: unknown) => {
      if (mode.kind === 'forwarded' && mode.prepareEnvironment !== undefined &&
          typeof message === 'object' && message !== null && 'kind' in message &&
          message.kind === 'forwarded-environment-needed' && 'id' in message && message.id === id) {
        if (admissionRequested || ready) return fail('Supervised session requested admission out of order.');
        admissionRequested = true;
        void mode.prepareEnvironment().then(({ environment, availableCredentialNames }) => {
          if (done) return;
          const entries = Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
          const accepted = Object.fromEntries(entries);
          if (Buffer.byteLength(JSON.stringify({ environment: accepted, availableCredentialNames }), 'utf8') > MAX_FORWARDED_ENVIRONMENT_BYTES) return fail('Supervised session admission environment is too large.');
          handedOverSecrets.push(...entries.map(([, value]) => value));
          admissionSent = true;
          child.send({ kind: 'forwarded-environment', id, environment: accepted, availableCredentialNames }, (error) => {
            if (error) fail('Supervised session admission channel failed.');
          });
        }).catch(() => fail('Secure runtime workspace admission failed. Check workspace trust and settings.'));
        return;
      }
      if (!isHandshakeMessage(message, id)) return fail('Supervised session sent an invalid readiness message.');
      if (message.kind === 'error') {
        return fail(refusalMessage(message, sentGrantIds, layout));
      }
      if (message.kind === 'ready' && !ready) {
        if (mode.kind === 'forwarded' && mode.prepareEnvironment !== undefined && !admissionSent) {
          return fail('Supervised session did not request workspace admission.');
        }
        if (!sameGrants(message.grants, sentGrantIds)) {
          return fail('Supervised session did not open exactly the external event grants it was given.');
        }
        ready = true;
        child.send({ kind: 'ack', id }, (error) => {
          if (error) fail('Supervised session acknowledgement failed.');
        });
        return;
      }
      if (message.kind === 'acknowledged' && ready && !acknowledged) {
        acknowledged = true;
        finishWhenReady();
      }
      else fail('Supervised session sent an out-of-order readiness message.');
    });
  });
}
