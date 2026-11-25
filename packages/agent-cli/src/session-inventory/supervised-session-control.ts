import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { randomBytes } from 'node:crypto';
import {
  lstatSync, mkdirSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

import { isLinkRequest } from '@robota-sdk/agent-transport/link';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface/transport';
import type {
  IExternalEventGrantCounters,
  IExternalEventGrantRow,
} from '../external-events/external-event-grant-host.js';

import {
  parseExternalEventGrant,
  toExternalEventGrantDocument,
} from '../external-events/external-event-grant-file.js';

import { resolveRendezvousDirectory } from '../remote-control/local-peer-rendezvous.js';
import { CONTROL_ACCESS, CONTROL_REQUEST_TIMEOUT_MS, MAX_CONTROL_FRAME_BYTES, SUPERVISED_ID_PATTERN, WindowsControlPipeServer, controlSocketPath, createSupervisedAttachCarrier, createWindowsPrivateDirectory, ensurePrivateDirectory, isControlCommandName, isControlCwd, isCurrentActivity, listSupervisedRuntimes, readRegisteredProcessStartTime as readProcessStartTime, readOwnedFile, requestSupervisedControl, sessionDirectory, verifyExistingDirectory, verifyLiveOwner, type IControlChannel, type IRegistration, type IRuntimeAdmission, type TControlCommandName, type TRuntimeAdmissionFactory, type TSupervisedActivity, type TSupervisedAttachTarget } from '@robota-sdk/agent-local-host';


const MAX_NAME_BYTES = 240;
const MAX_PR_URL_BYTES = 2_048;
const NAME_CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;


const GRANT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/u;
const MAX_GRANT_HANDOFF_BYTES = 256 * 1024;
const MAX_LISTED_GRANTS = 64;
const REFUSALS: ReadonlySet<string> = new Set([
  'oversize', 'malformed', 'wrong-type', 'unsupported-algorithm', 'ambiguous-key', 'unknown-key',
  'key-mismatch', 'bad-signature', 'wrong-issuer', 'wrong-audience', 'expired', 'not-yet-valid',
  'missing-scope', 'principal-not-allowed', 'keys-unavailable', 'missing-token', 'unknown-grant',
  'grant-revoked', 'source-closed', 'malformed-event', 'rate-limited', 'queue-full', 'shutting-down',
  'session-unavailable',
]);
const SETTLEMENTS: ReadonlySet<string> = new Set(['completed', 'interrupted', 'not-run', 'failed']);

/** A grant as a session listing shows it: label, state and counts, never the principal. */
export type TSupervisedGrantSummary = Omit<IExternalEventGrantRow, 'principal'>;

function isCountMap(value: unknown, keys: ReadonlySet<string>): value is Record<string, number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([key, count]) =>
      keys.has(key) && Number.isSafeInteger(count) && Number(count) >= 0);
}

function readGrantCounters(value: unknown): IExternalEventGrantCounters | undefined {
  if (typeof value !== 'object' || value === null || !('accepted' in value) || !('refused' in value) ||
    !('settled' in value) || !Number.isSafeInteger(value.accepted) || Number(value.accepted) < 0 ||
    !isCountMap(value.refused, REFUSALS) || !isCountMap(value.settled, SETTLEMENTS)) return undefined;
  return {
    accepted: Number(value.accepted),
    refused: { ...value.refused },
    settled: { ...value.settled },
  };
}

/** Rebuild a grant summary from exactly the fields it may carry, so nothing else is echoed. */
function readGrantSummary(value: unknown): TSupervisedGrantSummary | undefined {
  if (typeof value !== 'object' || value === null || !('grantId' in value) || !('state' in value) ||
    typeof value.grantId !== 'string' || !GRANT_ID_PATTERN.test(value.grantId) ||
    (value.state !== 'open' && value.state !== 'revoked') || !('counters' in value)) return undefined;
  const counters = readGrantCounters(value.counters);
  return counters === undefined ? undefined : { grantId: value.grantId, state: value.state, counters };
}

function readGrantRow(value: unknown): IExternalEventGrantRow | undefined {
  const summary = readGrantSummary(value);
  if (summary === undefined || typeof value !== 'object' || value === null || !('principal' in value) ||
    (value.principal !== 'subject' && value.principal !== 'client')) return undefined;
  return { grantId: summary.grantId, principal: value.principal, state: summary.state, counters: summary.counters };
}

function readList<T>(value: unknown, read: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LISTED_GRANTS) return undefined;
  const items = value.map(read);
  return items.every((item) => item !== undefined) ? (items as T[]) : undefined;
}


const MAX_DAEMON_URL_BYTES = 2_048;

/** A daemon's own loopback WebSocket URL, and nothing else, is handed to its owner. */
function isDaemonUrl(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_DAEMON_URL_BYTES ||
    /[\p{Cc}\p{Cf}\s]/u.test(value)) return false;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  return parsed.protocol === 'ws:' && parsed.hostname === '127.0.0.1' && parsed.port !== '' &&
    !parsed.username && !parsed.password && !parsed.hash;
}

function isLoopTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

export function isSupervisedSessionName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 &&
    value.trim() === value && !NAME_CONTROLS.test(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_NAME_BYTES;
}

export interface ISupervisedPr {
  readonly url: string;
  readonly host: string;
  readonly number: number;
  readonly kind: 'pull' | 'merge-request';
}

/** A caller-declared association, not a claim that the remote PR exists. */
export function parseSupervisedPr(value: unknown): ISupervisedPr | undefined {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_PR_URL_BYTES ||
    /[\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return undefined; }
  if (parsed.protocol !== 'https:' || parsed.href !== value || parsed.username || parsed.password ||
    parsed.port || parsed.search || parsed.hash || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(parsed.hostname)) return undefined;
  const pull = /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/([1-9][0-9]*)$/u.exec(parsed.pathname);
  const merge = /^\/(?:[A-Za-z0-9_.-]+\/)+-\/merge_requests\/([1-9][0-9]*)$/u.exec(parsed.pathname);
  const match = pull ?? merge;
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number)) return undefined;
  return { url: value, host: parsed.hostname, number, kind: pull ? 'pull' : 'merge-request' };
}

function isSupervisedPr(value: unknown): value is ISupervisedPr {
  if (typeof value !== 'object' || value === null || !('url' in value)) return false;
  const parsed = parseSupervisedPr(value.url);
  return parsed !== undefined && 'host' in value && value.host === parsed.host &&
    'number' in value && value.number === parsed.number && 'kind' in value && value.kind === parsed.kind;
}

export interface ISupervisedSessionRow {
  readonly id: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
  readonly control: 'available' | 'unavailable';
  readonly activity: TSupervisedActivity;
  readonly nextLoopAt?: string;
  readonly name?: string;
  readonly cwd?: string;
  readonly pr?: ISupervisedPr;
  /** Present only when requested: the live owner reports itself as its workspace's daemon. */
  readonly daemon?: true;
  /** Present only with `daemon`: the daemon runs Restricted, without the project's own configuration. */
  readonly restricted?: true;
  /** Present only when requested and verified: the registration this row's actions must still address. */
  readonly generation?: string;
  /** Present when requested and the endpoint reports secure custody. */
  readonly secure?: { readonly certified: boolean };
  /** Present only when requested: each external-event grant's label, state and counts. */
  readonly externalEvents?: readonly TSupervisedGrantSummary[];
  readonly problem?: 'invalid-registration';
}


export function resolveSupervisedDirectory(productRuntime: ICliRuntimeContext): string {
  return join(dirname(resolveRendezvousDirectory(productRuntime)), 'supervised');
}

/**
 * The first line a connection sends, as bytes, and whatever arrived with it, with the socket paused
 * again. It is bytes because the owner link's handshake follows its request line in the same chunk,
 * and a text decoder would rewrite what is not valid text, which a handshake mostly is. The bound
 * and the deadline are the ones every request has.
 */
function readRequestLine(socket: IControlChannel): Promise<{ readonly line: string; readonly rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    let done = false;
    const timer = setTimeout(
      () => finish(() => reject(new Error('Supervised session control timed out.'))),
      CONTROL_REQUEST_TIMEOUT_MS,
    );
    const finish = (action: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
      socket.pause();
      action();
    };
    const onData = (chunk: Buffer | string): void => {
      received = Buffer.concat([received, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk]);
      const end = received.indexOf(0x0a);
      // The bound is on the line itself: what follows it belongs to the protocol that line opens.
      if ((end === -1 ? received.length : end) > MAX_CONTROL_FRAME_BYTES) {
        finish(() => reject(new Error('Supervised session control frame is too large.')));
        return;
      }
      if (end !== -1) {
        finish(() =>
          resolve({
            line: received.subarray(0, end).toString('utf8'),
            rest: Buffer.from(received.subarray(end + 1)),
          }),
        );
      }
    };
    const onError = (): void => finish(() => reject(new Error('Supervised session control is unavailable.')));
    const onEnd = (): void => finish(() => reject(new Error('Supervised session control closed before replying.')));
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
  });
}

function optionalGrants(
  grants: TSupervisedGrantSummary[] | undefined,
): { readonly externalEvents?: readonly TSupervisedGrantSummary[] } {
  return grants === undefined ? {} : { externalEvents: grants };
}

export async function listSupervisedSessions(
  root: string,
  signal?: AbortSignal,
  options: { readonly cwd?: string; readonly name?: string; readonly pr?: number;
    readonly includeName?: boolean; readonly includeCwd?: boolean; readonly includePr?: boolean;
    readonly includeGeneration?: boolean; readonly includeExternalEvents?: boolean;
    readonly includeDaemon?: boolean; readonly includeSecure?: boolean } = {},
): Promise<readonly ISupervisedSessionRow[]> {
  const unfiltered = options.cwd === undefined && options.name === undefined && options.pr === undefined;
  const rows: ISupervisedSessionRow[] = [];
  for (const runtime of await listSupervisedRuntimes(root, signal)) {
    const { id, liveness, status } = runtime;
    if (status === undefined) {
      if (unfiltered) rows.push({ id, liveness, control: 'unavailable', activity: 'unknown',
        ...(runtime.problem ? { problem: runtime.problem } : {}) });
      continue;
    }
    const { reply } = status;
    if (options.cwd !== undefined && (!('cwd' in reply) || reply.cwd !== options.cwd)) continue;
    const name = 'name' in reply && isSupervisedSessionName(reply.name) ? reply.name : undefined;
    const pr = 'pr' in reply && isSupervisedPr(reply.pr) ? reply.pr : undefined;
    if (options.name !== undefined && !name?.toLowerCase().includes(options.name.toLowerCase())) continue;
    if (options.pr !== undefined && pr?.number !== options.pr) continue;
    rows.push({
      id, liveness, control: 'available', activity: status.activity,
      ...(options.includeName && name !== undefined ? { name } : {}),
      ...(options.includeCwd && status.cwd !== undefined ? { cwd: status.cwd } : {}),
      ...(options.includePr && pr !== undefined ? { pr } : {}),
      ...(options.includeGeneration ? { generation: runtime.generation } : {}),
      ...(options.includeSecure && status.certified !== undefined
        ? { secure: { certified: status.certified } } : {}),
      ...(options.includeDaemon && status.daemon === true
        ? { daemon: true as const, ...(status.restricted === true ? { restricted: true as const } : {}) }
        : {}),
      ...(options.includeExternalEvents && 'externalEvents' in reply
        ? optionalGrants(readList(reply.externalEvents, readGrantSummary)) : {}),
      ...(status.activity === 'idle' && 'nextLoopAt' in reply && isLoopTime(reply.nextLoopAt)
        ? { nextLoopAt: reply.nextLoopAt } : {}),
    });
  }
  return rows;
}

export async function renameSupervisedSession(
  id: string,
  name: string,
  root: string,
  expectedGeneration?: string,
): Promise<void> {
  sessionDirectory(root, id);
  if (!isSupervisedSessionName(name)) throw new Error('Supervised session name is invalid or too long.');
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await requestSupervisedControl(directory, id, generation, 'rename', undefined, { name });
  if (!('status' in response) || response.status !== 'renamed') {
    throw new Error('Supervised session did not confirm rename.');
  }
}

/**
 * Re-read the registration at action time instead of trusting a displayed row: its generation must
 * still be the expected one, and the registered process must still be the one that wrote it.
 */

export async function linkSupervisedPr(
  id: string,
  url: string,
  root: string,
  expectedGeneration?: string,
): Promise<void> {
  if (!parseSupervisedPr(url)) throw new Error('Invalid supervised session PR URL.');
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await requestSupervisedControl(directory, id, generation, 'link-pr', undefined, { url });
  if (!('status' in response) || response.status !== 'linked') {
    throw new Error('Supervised session did not confirm PR link.');
  }
}

export async function unlinkSupervisedPr(
  id: string,
  root: string,
  expectedGeneration?: string,
): Promise<void> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await requestSupervisedControl(directory, id, generation, 'unlink-pr');
  if (!('status' in response) || response.status !== 'unlinked') {
    throw new Error('Supervised session did not confirm PR unlink.');
  }
}

/** Re-probe the selected owner immediately before a user-triggered open action. */
export async function getVerifiedSupervisedPr(
  id: string,
  root: string,
  expectedGeneration?: string,
): Promise<ISupervisedPr | undefined> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await requestSupervisedControl(directory, id, generation, 'status');
  if (!('status' in response) || response.status !== 'running') {
    throw new Error('Supervised session control response was not verified.');
  }
  if (!('pr' in response)) return undefined;
  if (!isSupervisedPr(response.pr)) throw new Error('Supervised session PR association was not verified.');
  return response.pr;
}

/**
 * The WebSocket URL, token included, of a live daemon this user owns. Like every control action it
 * is bound to the start the caller verified; a session that is not a daemon refuses.
 */
export async function connectSupervisedDaemon(
  id: string,
  root: string,
  expectedGeneration?: string,
): Promise<string> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await requestSupervisedControl(directory, id, generation, 'connect');
  if (!('status' in response) || response.status !== 'connected' || !('url' in response) ||
    !isDaemonUrl(response.url)) {
    throw new Error('Supervised session did not hand over a daemon connection.');
  }
  return response.url;
}

/** The owner's grants on a live session: labels, principal kinds, states and counts. */
export async function listSupervisedExternalEvents(
  id: string,
  root: string,
  expectedGeneration?: string,
): Promise<readonly IExternalEventGrantRow[]> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await requestSupervisedControl(directory, id, generation, 'events-list');
  const grants = 'status' in response && response.status === 'events' && 'grants' in response
    ? readList(response.grants, readGrantRow) : undefined;
  if (grants === undefined) throw new Error('Supervised session did not list its external event grants.');
  return grants;
}

/** Withdraw one grant from a live session; later events for it are refused as revoked. */
export async function revokeSupervisedExternalEventGrant(
  id: string,
  grantId: string,
  root: string,
  expectedGeneration?: string,
): Promise<void> {
  if (!GRANT_ID_PATTERN.test(grantId)) throw new Error('Invalid external event grant label.');
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await requestSupervisedControl(directory, id, generation, 'events-revoke', undefined, { grantId });
  if ('status' in response && response.status === 'revoked') return;
  if ('reason' in response && response.reason === 'unknown-grant') {
    throw new Error(`Supervised session holds no external event grant ${grantId}.`);
  }
  throw new Error('Supervised session did not confirm the revocation.');
}

/** The owner-only directory a supervised session's external-event audit trail is written to. */
export function ensureSupervisedAuditDirectory(root: string): string {
  ensurePrivateDirectory(root);
  const directory = join(root, 'audit');
  ensurePrivateDirectory(directory);
  return directory;
}

function grantHandoffPath(root: string, id: string): string {
  sessionDirectory(root, id);
  return join(root, `.${id}.grants.json`);
}

/**
 * Hand a starting child its exact grants through a private file: not argv, which other local users
 * can read, and not the control socket. The file holds public configuration only.
 */
export function writeSupervisedGrantHandoff(
  root: string,
  id: string,
  grants: readonly IExternalEventGrant[],
): void {
  ensurePrivateDirectory(root);
  writeFileSync(grantHandoffPath(root, id), JSON.stringify(grants.map(toExternalEventGrantDocument)),
    { flag: 'wx', mode: 0o600 });
}

export function discardSupervisedGrantHandoff(root: string, id: string): void {
  rmSync(grantHandoffPath(root, id), { force: true });
}

/** Read and delete the handoff, re-validating every grant; a refused or missing file refuses the start. */
export function takeSupervisedGrantHandoff(root: string, id: string): IExternalEventGrant[] {
  const file = grantHandoffPath(root, id);
  let documents: unknown;
  try {
    verifyExistingDirectory(root);
    documents = JSON.parse(readOwnedFile(file, {
      ownerOnly: true, maxBytes: MAX_GRANT_HANDOFF_BYTES, refusal: 'refused',
    })) as unknown;
  } catch {
    throw new Error('Supervised external event grants could not be read.');
  } finally {
    rmSync(file, { force: true });
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error('Supervised external event grants could not be read.');
  }
  return documents.map((document, index) => parseExternalEventGrant(document, index + 1));
}

/** What the supervised process exposes about its external-event grants over the control socket. */
export interface ISupervisedExternalEvents {
  list(): readonly IExternalEventGrantRow[];
  revoke(grantId: string): 'revoked' | 'unknown-grant';
}

/** A daemon's control hands its owner the URL its transport is served on. */
export interface ISupervisedDaemon {
  /** `undefined` until the transport is bound, or once the runtime is stopping. */
  url(): string | undefined;
  /** It runs Restricted, so a start that needs the project's configuration does not reuse it. */
  readonly restricted?: boolean;
}

export interface ISupervisedControl {
  close(): Promise<void>;
}

/** What a control endpoint observes of its runtime; whatever is left out is not reported. */
export interface IControlObservation {
  readonly activity?: (() => Exclude<TSupervisedActivity, 'unknown'> | undefined) | undefined;
  readonly cwd?: (() => string | undefined) | undefined;
  readonly nextLoopAt?: (() => string | undefined) | undefined;
  readonly name?: (() => string | undefined) | undefined;
}

export interface ISupervisedControlOptions {
  /** The runtime's supervised id, the name of its registration and socket. */
  readonly id: string;
  /** The private directory the registration and socket live in. */
  readonly root: string;
  /** Called after a stop request has been answered. */
  readonly onStop: () => void;
  readonly observe?: IControlObservation | undefined;
  readonly rename?: ((name: string) => void) | undefined;
  readonly pr?:
    | {
        readonly get: () => ISupervisedPr | undefined;
        readonly set: (value: ISupervisedPr | undefined) => void;
      }
    | undefined;
  readonly externalEvents?: ISupervisedExternalEvents | undefined;
  readonly attachTarget?: TSupervisedAttachTarget | undefined;
  readonly daemon?: ISupervisedDaemon | undefined;
  /**
   * Makes this a secure runtime's endpoint: the commands a same-user program may send shrink to
   * what `CONTROL_ACCESS` leaves open in secure mode, the rest is the owner's through an owner link
   * the custody serves, and `status` reports what the custody says. Absent, every command is open
   * as it always was.
   */
  readonly admission?: TRuntimeAdmissionFactory | undefined;
}

/**
 * Who a command's answer is for: `plain` is a plain runtime's socket (everything, as always), `open`
 * is a secure runtime's socket (what a program of this user may learn), `owner` is an admitted
 * owner's `control` request (what the owner may learn).
 */
type TControlView = 'plain' | 'open' | 'owner';

/** What one command answers, and what must happen once the answer has been written. */
interface IControlOutcome {
  readonly body: Record<string, unknown>;
  readonly afterReply?: () => void;
}

/**
 * One request's fields as a command reads them: the plain socket's request line, or the fields of an
 * owner link's `control` request.
 */
type TControlRequest = Readonly<Record<string, unknown>>;

/**
 * Every command that answers from the runtime's own state, in one place, so the plain socket and an
 * owner link's `control` request give the same answers. A command whose handler the runtime did not
 * supply answers `refused`, as does one that is not an answer from state (attach, lock, link).
 */
function createControlHandler(
  options: ISupervisedControlOptions,
  admissionOf: () => IRuntimeAdmission | undefined,
): (command: TControlCommandName, request: TControlRequest, view: TControlView) => IControlOutcome {
  const { observe, rename, pr, externalEvents, daemon } = options;
  const refused: IControlOutcome = { body: { status: 'refused' } };
  const status = (view: TControlView): IControlOutcome => {
    const custody = admissionOf()?.status();
    // What names the work stays out of a secure runtime's open answer, and is not even read for it.
    const named = view !== 'open';
    let observed: unknown;
    let cwd: string | undefined;
    let nextLoopAt: unknown;
    let name: unknown;
    let linkedPr: unknown;
    try {
      observed = observe?.activity?.();
    } catch {
      // A failed observation cannot turn a verified control endpoint into a false activity claim.
    }
    try {
      cwd = observe?.cwd?.();
    } catch {
      // A directory that cannot be verified is omitted, never guessed from registration data.
    }
    if (observed === 'idle') {
      try {
        nextLoopAt = observe?.nextLoopAt?.();
      } catch {
        // A failed loop observation cannot turn an idle session into a false wake claim.
      }
    }
    try {
      if (named) name = observe?.name?.();
    } catch {
      // A failed name observation does not change the session's verified activity.
    }
    try {
      if (named) linkedPr = pr?.get();
    } catch {
      // A failed association observation cannot create a link.
    }
    let grants: TSupervisedGrantSummary[] | undefined;
    try {
      if (named) {
        grants = externalEvents?.list().map(({ grantId, state, counters }) => ({ grantId, state, counters }));
      }
    } catch {
      // Counts that cannot be read are omitted, never guessed.
    }
    return {
      body: {
        status: 'running',
        activity: isCurrentActivity(observed) ? observed : 'unknown',
        ...(isControlCwd(cwd) ? { cwd } : {}),
        ...(isLoopTime(nextLoopAt) ? { nextLoopAt } : {}),
        ...(isSupervisedSessionName(name) ? { name } : {}),
        ...(isSupervisedPr(linkedPr) ? { pr: linkedPr } : {}),
        ...(grants !== undefined && grants.length > 0 ? { externalEvents: grants } : {}),
        ...(custody === undefined
          ? daemon !== undefined
            ? { daemon: true, ...(daemon.restricted === true ? { restricted: true } : {}) }
            : {}
          : {
              ...(custody.daemon
                ? { daemon: true, ...(custody.restricted ? { restricted: true } : {}) }
                : {}),
              certified: custody.certified,
            }),
      },
    };
  };
  return (command, request, view) => {
    switch (command) {
      case 'status':
        return status(view);
      case 'lock': {
        const admission = admissionOf();
        if (admission === undefined) return refused;
        admission.lock();
        return { body: { status: 'locked' } };
      }
      case 'take-daemon-role':
        return admissionOf()?.takeDaemonRole() === true ? { body: { status: 'daemon' } } : refused;
      case 'connect': {
        if (daemon === undefined || admissionOf() !== undefined) return refused;
        let url: unknown;
        try {
          url = daemon.url();
        } catch {
          // A URL that cannot be read is never guessed.
        }
        return isDaemonUrl(url) ? { body: { status: 'connected', url } } : refused;
      }
      case 'stop':
        return { body: { status: 'stopping' }, afterReply: options.onStop };
      case 'rename': {
        const name = request['name'];
        if (!isSupervisedSessionName(name) || rename === undefined) return refused;
        try {
          rename(name);
          return { body: { status: 'renamed' } };
        } catch {
          return refused;
        }
      }
      case 'link-pr': {
        if (!('url' in request) || pr?.set === undefined) return refused;
        const linked = parseSupervisedPr(request['url']);
        if (!linked) return refused;
        try {
          pr.set(linked);
          return { body: { status: 'linked' } };
        } catch {
          return refused;
        }
      }
      case 'events-list': {
        if (externalEvents === undefined) return refused;
        try {
          return { body: { status: 'events', grants: externalEvents.list() } };
        } catch {
          return refused;
        }
      }
      case 'events-revoke': {
        const grantId = request['grantId'];
        if (externalEvents === undefined || typeof grantId !== 'string' || !GRANT_ID_PATTERN.test(grantId)) {
          return refused;
        }
        try {
          return {
            body: externalEvents.revoke(grantId) === 'revoked'
              ? { status: 'revoked' }
              : { status: 'refused', reason: 'unknown-grant' },
          };
        } catch {
          return refused;
        }
      }
      case 'unlink-pr': {
        if (pr?.set === undefined) return refused;
        try {
          pr.set(undefined);
          return { body: { status: 'unlinked' } };
        } catch {
          return refused;
        }
      }
      default:
        // `attach` needs its socket, and `link` is not an answer from state at all.
        return refused;
    }
  };
}

export async function startSupervisedControl(options: ISupervisedControlOptions): Promise<ISupervisedControl> {
  const { id, root, attachTarget } = options;
  if (!SUPERVISED_ID_PATTERN.test(id)) throw new Error('Invalid supervised session ID.');
  ensurePrivateDirectory(root);
  const directory = sessionDirectory(root, id);
  // A UUID directory is visible to list only after its registration is complete.
  const pendingDirectory = join(root, `.${id}.pending`);
  const socketPath = controlSocketPath(root, id);
  // One value per process start: a request bound to any other start is refused, never acted on.
  const generation = randomBytes(16).toString('base64url');
  // The request reader leaves a socket paused, so that an owner link or an attach can take it over
  // with nothing lost. Every answer that ends the connection reads again first: a paused socket with
  // bytes behind its request line never sees its peer close, and would hold its descriptors for good.
  const reply = (socket: IControlChannel, body: Record<string, unknown>): void => {
    socket.resume();
    socket.end(`${JSON.stringify({ id, ...body, generation })}\n`);
  };
  // A caller that has not named this start learns nothing from the refusal: the generation is part
  // of the proof a later request presents, so it is echoed only to a caller that already holds it.
  const refuse = (socket: IControlChannel, reason?: 'stale-generation'): void => {
    socket.resume();
    socket.end(`${JSON.stringify({ id, status: 'refused', ...(reason ? { reason } : {}) })}\n`);
  };
  const attach = attachTarget === undefined
    ? undefined
    : createSupervisedAttachCarrier(attachTarget);
  let admission: IRuntimeAdmission | undefined;
  const handle = createControlHandler(options, () => admission);
  admission = options.admission?.({
    binding: { runtimeId: id, generation },
    control: (command, fields) => {
      // Only what an owner may send, plus the whole status that the open one trims.
      if (!isControlCommandName(command)) return { status: 'refused' };
      if (CONTROL_ACCESS[command].secure !== 'owner-control' && command !== 'status') {
        return { status: 'refused' };
      }
      return handle(command, fields, 'owner').body;
    },
  });
  const clients = new Set<IControlChannel>();
  const onConnection = (socket: IControlChannel): void => {
    clients.add(socket);
    // readLine owns request errors only; write-side EPIPE can arrive after its listener is removed.
    socket.on('error', () => socket.destroy());
    socket.once('close', () => clients.delete(socket));
    void readRequestLine(socket).then(({ line, rest }) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        refuse(socket);
        return;
      }
      // An owner link names no runtime and no start; the handshake that follows proves both.
      if (isLinkRequest(value)) {
        if (admission === undefined) refuse(socket);
        else admission.serveLink(socket, rest);
        return;
      }
      if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== id || !('command' in value)) {
        refuse(socket);
        return;
      }
      if (!('generation' in value) || value.generation !== generation) {
        refuse(socket, 'stale-generation');
        return;
      }
      const command = value.command;
      const access =
        isControlCommandName(command)
          ? admission === undefined
            ? CONTROL_ACCESS[command].plain
            : CONTROL_ACCESS[command].secure
          : 'absent';
      // `owner-control` commands are the owner's, and reach the runtime only inside an owner link.
      if (!isControlCommandName(command) || access === 'absent' || access === 'owner-control') {
        reply(socket, { status: 'refused' });
        return;
      }
      if (command === 'attach') {
        // The protocol that follows is text: what arrived with the request line goes back in front of
        // the stream, which decodes it from here on, and the socket stays paused until the carrier
        // takes over, so nothing sent after the handshake is dropped.
        if (rest.length > 0) socket.unshift(rest);
        socket.setEncoding('utf8');
        socket.pause();
        // A refused handshake reads again, so the peer's close is seen and the socket is released.
        const refuse = (reason: string): void => {
          socket.resume();
          reply(socket, { status: 'refused', reason });
        };
        if (attach === undefined) {
          refuse('attach-unavailable');
          return;
        }
        void attach.admit(socket, value, '', {
          refuse,
          accept: (driverId) => {
            socket.write(`${JSON.stringify({ id, status: 'attached', driverId, generation })}\n`);
          },
        }).catch(() => socket.destroy());
        return;
      }
      const outcome = handle(command, value as TControlRequest, admission === undefined ? 'plain' : 'open');
      if (outcome.afterReply !== undefined) socket.once('finish', outcome.afterReply);
      reply(socket, outcome.body);
    }).catch(() => socket.destroy());
  };
  const server = process.platform === 'win32' ? new WindowsControlPipeServer(onConnection) : createServer(onConnection);
  let bound = false;
  try {
    if (process.platform === 'win32') createWindowsPrivateDirectory(pendingDirectory, true);
    else mkdirSync(pendingDirectory, { mode: 0o700 });
    verifyExistingDirectory(pendingDirectory);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    bound = true;
    const startedAt = readProcessStartTime(process.pid);
    if (!startedAt) throw new Error('Unable to prove supervised session process identity.');
    const registration: IRegistration = {
      id,
      pid: process.pid,
      startedAt,
      generation,
    };
    writeFileSync(join(pendingDirectory, 'state.json'), JSON.stringify(registration), { flag: 'wx', mode: 0o600 });
    try {
      lstatSync(directory);
      throw new Error('Supervised session ID is already registered.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    renameSync(pendingDirectory, directory);
  } catch (error) {
    if (bound) server.close();
    if (bound && process.platform !== 'win32') rmSync(socketPath, { force: true });
    rmSync(pendingDirectory, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  return {
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of clients) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== 'win32') rmSync(socketPath, { force: true });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
