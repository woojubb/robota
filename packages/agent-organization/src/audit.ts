import { createHash, verify } from 'node:crypto';
import { organizationCanonical, organizationOperationDigest } from './canonical.js';
import { integer, identifier, publicKey, record, requestClaims } from './verification.js';
import { OrganizationRefused } from './types.js';
import type { IOrganizationEnvelope, IOrganizationRequest } from './types.js';

export type TOrganizationAuditPhase = 'dispatch' | 'complete' | 'refused' | 'unknown';
export interface IOrganizationAuditEvent {
  readonly phase: TOrganizationAuditPhase;
  readonly operationDigest: string;
  readonly tenantDigest: string;
  readonly taskDigest: string;
  readonly actorDigest: string;
  readonly grantDigest: string;
  readonly epoch: number;
}
export interface IOrganizationAuditHead {
  readonly version: 1;
  readonly stream: string;
  readonly sequence: number;
  readonly hash: string;
}
export interface IOrganizationAuditEntry {
  readonly stream: string;
  readonly sequence: number;
  readonly previous: string;
  readonly event: IOrganizationAuditEvent;
  readonly hash: string;
}
export interface IOrganizationAuditPage {
  readonly entries: readonly IOrganizationAuditEntry[];
  readonly head: IOrganizationEnvelope<IOrganizationAuditHead>;
}
/** A trusted sink may report this only when its expected-head CAS made no append. Other failures are ambiguous. */
export class OrganizationAuditAppendConflict extends Error {
  constructor() {
    super('Organization audit append conflict');
  }
}
/** Owner-installed external storage; read is consistent and append is an atomic expected-head CAS. */
export interface IOrganizationAuditSink {
  read(after: IOrganizationAuditHead, signal: AbortSignal): Promise<IOrganizationAuditPage>;
  append(
    expected: IOrganizationAuditHead,
    event: IOrganizationAuditEvent,
    signal: AbortSignal,
  ): Promise<{
    readonly entry: IOrganizationAuditEntry;
    readonly head: IOrganizationEnvelope<IOrganizationAuditHead>;
  }>;
}
/** Independently retained checkpoint: consistent reads, monotonic CAS, no reset/delete worker capability. */
export interface IOrganizationAuditAnchor {
  load(signal: AbortSignal): Promise<IOrganizationEnvelope<IOrganizationAuditHead>>;
  compareAndSet(
    expected: IOrganizationAuditHead,
    next: IOrganizationEnvelope<IOrganizationAuditHead>,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export interface IOrganizationAuditWriter {
  record(event: IOrganizationAuditEvent, signal?: AbortSignal): Promise<void>;
}
export interface IOrganizationAuditOptions {
  readonly stream: string;
  readonly publicKey: string;
  readonly sink: IOrganizationAuditSink;
  readonly anchor: IOrganizationAuditAnchor;
  readonly timeoutMs?: number;
}
const HASH = /^[0-9a-f]{64}$/;
const PHASES = ['dispatch', 'complete', 'refused', 'unknown'];
function digest(value: unknown): string {
  return createHash('sha256').update(organizationCanonical(value), 'utf8').digest('hex');
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value))
    throw new OrganizationRefused('invalid-schema');
  return value;
}
function head(value: unknown, stream: string): IOrganizationAuditHead {
  const data = record(value, ['version', 'stream', 'sequence', 'hash']);
  if (data.version !== 1 || data.stream !== stream) throw new OrganizationRefused('invalid-schema');
  return Object.freeze({
    version: 1,
    stream,
    sequence: integer(data.sequence),
    hash: hash(data.hash),
  });
}
function event(value: unknown): IOrganizationAuditEvent {
  const data = record(value, [
    'phase',
    'operationDigest',
    'tenantDigest',
    'taskDigest',
    'actorDigest',
    'grantDigest',
    'epoch',
  ]);
  if (typeof data.phase !== 'string' || !PHASES.includes(data.phase))
    throw new OrganizationRefused('invalid-schema');
  return Object.freeze({
    phase: data.phase as TOrganizationAuditPhase,
    operationDigest: hash(data.operationDigest),
    tenantDigest: hash(data.tenantDigest),
    taskDigest: hash(data.taskDigest),
    actorDigest: hash(data.actorDigest),
    grantDigest: hash(data.grantDigest),
    epoch: integer(data.epoch, 1),
  });
}
export function organizationAuditEvent(
  value: IOrganizationRequest,
  phase: TOrganizationAuditPhase,
): IOrganizationAuditEvent {
  if (!PHASES.includes(phase)) throw new OrganizationRefused('invalid-schema');
  const request = requestClaims(value);
  const pseudonym = (kind: string, parts: readonly string[]): string =>
    digest(['robota/organization-audit-identity/v1', kind, parts]);
  return Object.freeze({
    phase,
    operationDigest: organizationOperationDigest(request),
    tenantDigest: pseudonym('tenant', [request.tenant]),
    taskDigest: pseudonym('task', [request.tenant, request.task]),
    actorDigest: pseudonym('actor', [request.tenant, request.actor]),
    grantDigest: pseudonym('grant', [request.grantId]),
    epoch: request.epoch,
  });
}
export function organizationAuditGenesis(stream: string): IOrganizationAuditHead {
  identifier(stream);
  return Object.freeze({
    version: 1,
    stream,
    sequence: 0,
    hash: digest(['robota/organization-audit-genesis/v1', stream]),
  });
}
export function organizationAuditHash(
  stream: string,
  sequence: number,
  previous: string,
  value: IOrganizationAuditEvent,
): string {
  return digest([
    'robota/organization-audit-entry/v1',
    identifier(stream),
    integer(sequence, 1),
    hash(previous),
    event(value),
  ]);
}
/** Public signing bytes for an external audit owner; this package never accepts its private key. */
export function organizationAuditSigningBytes(value: IOrganizationAuditHead): Buffer {
  return Buffer.from(
    organizationCanonical([
      'robota/organization-audit-checkpoint/v1',
      head(value, identifier(value.stream)),
    ]),
    'utf8',
  );
}
function checkpoint(
  value: unknown,
  stream: string,
  key: ReturnType<typeof publicKey>,
): IOrganizationEnvelope<IOrganizationAuditHead> {
  const data = record(value, ['claims', 'signature']);
  const claims = head(data.claims, stream);
  if (typeof data.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(data.signature))
    throw new OrganizationRefused('invalid-proof');
  const signature = Buffer.from(data.signature, 'base64url');
  if (
    signature.length !== 64 ||
    signature.toString('base64url') !== data.signature ||
    !verify(null, organizationAuditSigningBytes(claims), key, signature)
  )
    throw new OrganizationRefused('invalid-proof');
  if (claims.sequence === 0 && claims.hash !== organizationAuditGenesis(stream).hash)
    throw new OrganizationRefused('invalid-proof');
  return Object.freeze({ claims, signature: data.signature });
}
function entry(value: unknown, previous: IOrganizationAuditHead): IOrganizationAuditEntry {
  const data = record(value, ['stream', 'sequence', 'previous', 'event', 'hash']);
  const safeEvent = event(data.event);
  if (
    data.stream !== previous.stream ||
    data.sequence !== previous.sequence + 1 ||
    data.previous !== previous.hash
  )
    throw new OrganizationRefused('invalid-proof');
  const computed = organizationAuditHash(
    previous.stream,
    integer(data.sequence, 1),
    previous.hash,
    safeEvent,
  );
  if (data.hash !== computed) throw new OrganizationRefused('invalid-proof');
  return Object.freeze({
    stream: previous.stream,
    sequence: data.sequence as number,
    previous: previous.hash,
    event: safeEvent,
    hash: computed,
  });
}
function same(a: IOrganizationAuditHead, b: IOrganizationAuditHead): boolean {
  return a.stream === b.stream && a.sequence === b.sequence && a.hash === b.hash;
}
function page(
  value: unknown,
  start: IOrganizationAuditHead,
  key: ReturnType<typeof publicKey>,
): IOrganizationEnvelope<IOrganizationAuditHead> {
  const data = record(value, ['entries', 'head']);
  if (!Array.isArray(data.entries) || data.entries.length > 128)
    throw new OrganizationRefused('invalid-schema');
  const last = checkpoint(data.head, start.stream, key);
  let current = start;
  for (const item of data.entries) {
    const next = entry(item, current);
    current = { version: 1, stream: next.stream, sequence: next.sequence, hash: next.hash };
  }
  if (!same(current, last.claims)) throw new OrganizationRefused('invalid-proof');
  return last;
}
/** Verify a bounded continuation against pinned signed checkpoints, without trusting a mutable local head. */
export function verifyOrganizationAudit(
  entries: readonly IOrganizationAuditEntry[],
  start: IOrganizationEnvelope<IOrganizationAuditHead>,
  end: IOrganizationEnvelope<IOrganizationAuditHead>,
  pinnedKey: string,
  pinnedStream: string,
): IOrganizationAuditHead {
  const key = publicKey(pinnedKey);
  const first = checkpoint(start, identifier(pinnedStream), key);
  return page({ entries, head: end }, first.claims, key).claims;
}
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = (): void => {
      cleanup();
      reject(new OrganizationRefused('policy-unavailable'));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
function active(signal: AbortSignal): void {
  if (signal.aborted) throw new OrganizationRefused('policy-unavailable');
}

/** Dispatch can proceed only after an exact event and its independently retained checkpoint are confirmed. */
export class OrganizationAudit implements IOrganizationAuditWriter {
  private readonly stream: string;
  private readonly key;
  private readonly sink: IOrganizationAuditSink;
  private readonly anchor: IOrganizationAuditAnchor;
  private readonly timeout: number;
  constructor(options: IOrganizationAuditOptions) {
    this.stream = identifier(options.stream);
    this.key = publicKey(options.publicKey);
    this.timeout = integer(options.timeoutMs ?? 1000, 1);
    if (
      this.timeout > 30_000 ||
      typeof options.sink?.read !== 'function' ||
      typeof options.sink?.append !== 'function' ||
      typeof options.anchor?.load !== 'function' ||
      typeof options.anchor?.compareAndSet !== 'function'
    )
      throw new OrganizationRefused('invalid-schema');
    this.sink = Object.freeze({
      read: options.sink.read.bind(options.sink),
      append: options.sink.append.bind(options.sink),
    });
    this.anchor = Object.freeze({
      load: options.anchor.load.bind(options.anchor),
      compareAndSet: options.anchor.compareAndSet.bind(options.anchor),
    });
  }
  private async bounded<T>(
    work: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let rejectAbort!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new OrganizationRefused('policy-unavailable'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    const timer = setTimeout(abort, this.timeout);
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          active(controller.signal);
          return work(controller.signal);
        }),
        stopped,
      ]);
    } catch {
      throw new OrganizationRefused('policy-unavailable');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', rejectAbort);
      controller.abort();
    }
  }
  async record(value: IOrganizationAuditEvent, signal?: AbortSignal): Promise<void> {
    const projected = event(value);
    await this.bounded(async (lifetime) => {
      let delay = 5;
      for (;;) {
        active(lifetime);
        const anchored = checkpoint(await this.anchor.load(lifetime), this.stream, this.key);
        active(lifetime);
        const current = page(
          await this.sink.read(anchored.claims, lifetime),
          anchored.claims,
          this.key,
        );
        active(lifetime);
        // A concurrent publisher may still be anchoring. Wait boundedly; never publish its tail automatically.
        if (!same(current.claims, anchored.claims)) {
          await pause(delay, lifetime);
          delay = Math.min(delay * 2, 50);
          continue;
        }
        let response;
        try {
          response = record(await this.sink.append(anchored.claims, projected, lifetime), [
            'entry',
            'head',
          ]);
        } catch (error) {
          active(lifetime);
          if (!(error instanceof OrganizationAuditAppendConflict)) throw error;
          await pause(delay, lifetime);
          delay = Math.min(delay * 2, 50);
          continue;
        }
        active(lifetime);
        const written = entry(response.entry, anchored.claims);
        const next = checkpoint(response.head, this.stream, this.key);
        if (
          organizationCanonical(written.event) !== organizationCanonical(projected) ||
          !same(next.claims, {
            version: 1,
            stream: written.stream,
            sequence: written.sequence,
            hash: written.hash,
          })
        )
          throw new OrganizationRefused('invalid-proof');
        const confirmed = await this.anchor.compareAndSet(anchored.claims, next, lifetime);
        active(lifetime);
        if (confirmed !== true) throw new OrganizationRefused('policy-unavailable');
        return;
      }
    }, signal);
  }
  /** Owner-only recovery of a valid already-written tail. Does not reset history, refund or retry any effect. */
  async recover(signal?: AbortSignal): Promise<IOrganizationAuditHead> {
    return this.bounded(async (lifetime) => {
      const anchored = checkpoint(await this.anchor.load(lifetime), this.stream, this.key);
      active(lifetime);
      const current = page(
        await this.sink.read(anchored.claims, lifetime),
        anchored.claims,
        this.key,
      );
      active(lifetime);
      if (same(current.claims, anchored.claims)) return current.claims;
      const confirmed = await this.anchor.compareAndSet(anchored.claims, current, lifetime);
      active(lifetime);
      if (confirmed !== true) throw new OrganizationRefused('policy-unavailable');
      return current.claims;
    }, signal);
  }

  /** Readiness verifies retained evidence without adopting an unconfirmed tail or resetting history. */
  async verify(signal?: AbortSignal): Promise<IOrganizationAuditHead> {
    return this.bounded(async (lifetime) => {
      let delay = 5;
      for (;;) {
        const anchored = checkpoint(await this.anchor.load(lifetime), this.stream, this.key);
        active(lifetime);
        const current = page(await this.sink.read(anchored.claims, lifetime), anchored.claims, this.key);
        active(lifetime);
        if (same(current.claims, anchored.claims)) return anchored.claims;
        // Concurrent publication is not corruption. Withhold readiness until the owner confirms it.
        await pause(delay, lifetime);
        delay = Math.min(delay * 2, 50);
      }
    }, signal);
  }
}
