import { isTurnNotRunError } from '@robota-sdk/agent-interface-session';

import { DEFAULT_PEER_TURN_RATE_WINDOWS, PeerTurnRateLimiter } from './peer-turn-rate-limit.js';

import type {
  ISubmitOptions,
  ITurnHandle,
  TTurnNotRunReason,
} from '@robota-sdk/agent-interface-session';
import type {
  IAccessTokenVerifier,
  IAccessTokenVerifierConfig,
  IExternalEventGrant,
  TExternalEventAuditRecord,
  TExternalEventRefusal,
  TExternalEventSettlementOutcome,
} from '@robota-sdk/agent-interface-transport';
import type { TPermissionMode } from '@robota-sdk/agent-core';

/**
 * One grant's source. The ingress builds the grant's verifier from `grant.verifier` with the factory
 * its host was constructed with, so the principal the grant pins is the one its tokens are checked
 * against; opening a grant carries no verifier and no factory. The host carries the pair a carrier
 * delivers and trusts nothing else it says.
 */
export interface IExternalEventSourceOptions {
  readonly grant: IExternalEventGrant;
  /** Receives one content-free record per refusal and per settlement. A throw is ignored. */
  readonly audit?: (record: TExternalEventAuditRecord) => void;
}

export type TExternalEventSettlement =
  | { readonly outcome: 'completed'; readonly response: string }
  | { readonly outcome: 'interrupted' }
  | { readonly outcome: 'not-run'; readonly reason: TTurnNotRunReason }
  | { readonly outcome: 'failed'; readonly reason: string };

/** An admission names its turn; `settled` is for the host, never for the sender. */
export type TExternalEventReceipt =
  | {
      readonly admitted: true;
      readonly turnId: string;
      readonly settled: Promise<TExternalEventSettlement>;
    }
  | { readonly admitted: false; readonly refusal: TExternalEventRefusal };

export interface IExternalEventSource {
  readonly grantId: string;
  /** Take one delivery (`IExternalEventDelivery`) exactly as a carrier received it. */
  receive(delivery: unknown): Promise<TExternalEventReceipt>;
  /** Stop admission synchronously; already-submitted turns retain their exact settlement. */
  close(): void;
  /**
   * Withdraw the grant: later events are refused as revoked, its queued and running turns are
   * stopped, and the label cannot be opened again on this ingress.
   */
  revoke(): void;
}

export interface IExternalEventHost {
  getPermissionMode(): TPermissionMode;
  addPermissionModeGuard(guard: (next: TPermissionMode) => void): () => void;
  submit(input: string, options: ISubmitOptions): Promise<ITurnHandle>;
  /** The host's one way to build a verifier; the ingress calls it with each grant's own config. */
  createVerifier(config: IAccessTokenVerifierConfig): IAccessTokenVerifier;
  /** Wall-clock milliseconds, for rate windows, token expiry and audit times. */
  now?: () => number;
  /** Whether the session has begun shutting down; a refused submission is then named so. */
  isShuttingDown?: () => boolean;
  /**
   * The run's grant history (#3189). A run that switches sessions lends every session the same one,
   * so spent tokens, rate windows and revocations belong to the run: a switch replays nothing and
   * resets no rate. Without it, the history lives and ends with this session.
   */
  history?: ExternalEventGrantHistory;
}

const MAX_EVENT_BYTES = 16 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_JTI_LENGTH = 256;
/** Matches the verifier's `exp` skew, so a token is remembered for as long as it can verify. */
const REPLAY_SKEW_MS = 60_000;
/** Spent tokens remembered per grant; past this, with none expired, the grant is refused as over rate. */
const MAX_SPENT_TOKENS = 4096;
const GRANT_ID = /^[a-zA-Z0-9_-]{1,64}$/u;

function validIdentity(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Refuse a grant that is not exactly one principal, one kind and sane rate windows. */
function validateGrant(grant: IExternalEventGrant): void {
  if (!GRANT_ID.test(grant.grantId)) {
    throw new Error(
      'external event grant id must be 1–64 ASCII letters, digits, underscores or hyphens',
    );
  }
  const subjects = grant.verifier.allowedSubjects ?? [];
  const clients = grant.verifier.allowedClients ?? [];
  if (subjects.length + clients.length !== 1) {
    throw new Error(`external event grant ${grant.grantId} must pin exactly one subject or client`);
  }
  if (grant.verifier.requiredScopes.length === 0) {
    throw new Error(`external event grant ${grant.grantId} must require a scope`);
  }
  if (grant.kinds.length !== 1 || grant.kinds[0] !== 'message') {
    throw new Error(`external event grant ${grant.grantId} admits only the message kind`);
  }
  for (const window of grant.rate ?? []) {
    if (
      !Number.isSafeInteger(window.windowMs) ||
      window.windowMs <= 0 ||
      !Number.isSafeInteger(window.maxTurns) ||
      window.maxTurns <= 0
    ) {
      throw new Error(`external event grant ${grant.grantId} has an invalid rate window`);
    }
  }
}

/** The verified token's own name and lifetime, read only after the verifier admitted it. */
function spendableClaims(
  token: string,
): { readonly jti: string; readonly expiresAt: number } | undefined {
  const payload = token.split('.')[1];
  if (payload === undefined) return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!isRecord(claims)) return undefined;
  const { jti, exp } = claims;
  if (typeof jti !== 'string' || jti.length === 0 || jti.length > MAX_JTI_LENGTH) return undefined;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined;
  return { jti, expiresAt: exp * 1000 + REPLAY_SKEW_MS };
}

interface IMessage {
  readonly conversationId: string;
  readonly content: string;
  readonly claimedName?: string;
}

function readMessage(event: unknown): IMessage | 'malformed-event' | 'oversize' {
  if (!isRecord(event) || event['kind'] !== 'message') return 'malformed-event';
  const { conversationId, content, claimedName } = event;
  if (!validIdentity(conversationId) || typeof content !== 'string') return 'malformed-event';
  if (claimedName !== undefined && !validIdentity(claimedName)) return 'malformed-event';
  if (Buffer.byteLength(content, 'utf8') > MAX_EVENT_BYTES) return 'oversize';
  return { conversationId, content, ...(claimedName !== undefined ? { claimedName } : {}) };
}

/** What a grant has spent, kept per grant label so a closed and reopened grant cannot spend it again. */
interface IGrantHistory {
  /** Spent token ids and when each stops verifying. */
  readonly spent: Map<string, number>;
  readonly rate: PeerTurnRateLimiter;
  /** The rate windows `rate` counts against; a reopen with other windows starts a new count. */
  readonly windows: string;
  revoked: boolean;
}

function closedRefusal(source: ISourceState): TExternalEventRefusal {
  return source.history.revoked ? 'grant-revoked' : 'source-closed';
}

interface ISourceState {
  readonly grant: IExternalEventGrant;
  readonly verifier: IAccessTokenVerifier;
  readonly audit: IExternalEventSourceOptions['audit'];
  readonly rate: PeerTurnRateLimiter;
  readonly spent: Map<string, number>;
  readonly history: IGrantHistory;
  /** Stops this grant's queued and running turns when it is revoked. */
  readonly turns: AbortController;
  active: boolean;
  pending: number;
}

/** What a run remembers about each grant across the sessions it holds; opaque to its holder. */
export class ExternalEventGrantHistory {
  /** @internal */
  readonly grants = new Map<string, IGrantHistory>();
}

/** One history per run: create it once and pass it to every session the run builds. */
export function createExternalEventGrantHistory(): ExternalEventGrantHistory {
  return new ExternalEventGrantHistory();
}

/**
 * Session-owned admission and turn settlement for external events. The sender is the grant whose
 * verifier admitted the token; nothing in the delivery names it.
 */
export class ExternalEventIngress {
  private readonly sources = new Map<string, ISourceState>();
  private readonly history: Map<string, IGrantHistory>;
  private pending = 0;
  private releaseGuard?: () => void;
  private readonly now: () => number;

  constructor(private readonly host: IExternalEventHost) {
    this.now = host.now ?? Date.now;
    this.history = host.history?.grants ?? new Map();
  }

  open(options: IExternalEventSourceOptions): IExternalEventSource {
    const { grant } = options;
    if ('verifier' in options || 'createVerifier' in options) {
      throw new Error('external event grant verifier is built by the host from the grant itself');
    }
    validateGrant(grant);
    if (this.history.get(grant.grantId)?.revoked === true) {
      throw new Error(`external event grant ${grant.grantId} was revoked`);
    }
    if (this.sources.has(grant.grantId)) {
      throw new Error(
        `external event grant ${grant.grantId} is already open or still settling its turns`,
      );
    }
    if (this.host.getPermissionMode() === 'bypassPermissions') {
      throw new Error('external event ingress cannot run in bypassPermissions mode');
    }
    let verifier: IAccessTokenVerifier;
    try {
      verifier = this.host.createVerifier(grant.verifier);
    } catch {
      throw new Error(`external event grant ${grant.grantId}: its verifier could not be built`);
    }
    const history = this.historyOf(grant);
    const state: ISourceState = {
      grant,
      verifier,
      history,
      turns: new AbortController(),
      audit: options.audit,
      rate: history.rate,
      spent: history.spent,
      active: true,
      pending: 0,
    };
    if (!this.releaseGuard) {
      this.releaseGuard = this.host.addPermissionModeGuard((next) => {
        if (next === 'bypassPermissions' && (this.hasActiveSource() || this.pending > 0)) {
          throw new Error(
            'bypassPermissions is unavailable while external event ingress or its turns are active',
          );
        }
      });
    }
    this.sources.set(grant.grantId, state);
    return {
      grantId: grant.grantId,
      receive: async (delivery) => {
        const receipt = await this.receive(state, delivery);
        if (!receipt.admitted) this.record(state, { refusal: receipt.refusal });
        return receipt;
      },
      close: () => this.close(state),
      revoke: () => {
        history.revoked = true;
        state.turns.abort();
        this.close(state);
      },
    };
  }

  private historyOf(grant: IExternalEventGrant): IGrantHistory {
    const windows = grant.rate ?? DEFAULT_PEER_TURN_RATE_WINDOWS;
    const key = JSON.stringify(windows);
    const previous = this.history.get(grant.grantId);
    if (previous?.windows === key) return previous;
    const next: IGrantHistory = {
      spent: previous?.spent ?? new Map(),
      rate: new PeerTurnRateLimiter(windows, this.now),
      windows: key,
      revoked: false,
    };
    this.history.set(grant.grantId, next);
    return next;
  }

  closeAll(): void {
    for (const source of this.sources.values()) this.close(source);
  }

  private record(
    source: ISourceState,
    decision:
      | { readonly refusal: TExternalEventRefusal }
      | { readonly settlement: TExternalEventSettlementOutcome },
  ): void {
    try {
      source.audit?.({
        at: new Date(this.now()).toISOString(),
        grantId: source.grant.grantId,
        ...decision,
      });
    } catch {
      // An audit sink cannot change or block a decision.
    }
  }

  private hasActiveSource(): boolean {
    for (const source of this.sources.values()) if (source.active) return true;
    return false;
  }

  private close(source: ISourceState): void {
    if (!source.active) return;
    source.active = false;
    this.maybeRelease(source);
  }

  private maybeRelease(source: ISourceState): void {
    if (
      !source.active &&
      source.pending === 0 &&
      this.sources.get(source.grant.grantId) === source
    ) {
      this.sources.delete(source.grant.grantId);
    }
    if (this.sources.size === 0 && this.pending === 0) {
      this.releaseGuard?.();
      this.releaseGuard = undefined;
    }
  }

  /** Refuse a spent token, or one without a name; `undefined` means it may be spent. */
  private replayRefusal(
    source: ISourceState,
    claims: ReturnType<typeof spendableClaims>,
    at: number,
  ): TExternalEventRefusal | undefined {
    if (claims === undefined) return 'malformed';
    const spentUntil = source.spent.get(claims.jti);
    if (spentUntil !== undefined && spentUntil > at) return 'malformed';
    if (source.spent.size >= MAX_SPENT_TOKENS) {
      for (const [jti, until] of source.spent) if (until <= at) source.spent.delete(jti);
      if (source.spent.size >= MAX_SPENT_TOKENS) return 'rate-limited';
    }
    return undefined;
  }

  private async receive(source: ISourceState, delivery: unknown): Promise<TExternalEventReceipt> {
    if (!source.active) return { admitted: false, refusal: closedRefusal(source) };
    const token = isRecord(delivery) ? delivery['token'] : undefined;
    if (typeof token !== 'string' || token.length === 0)
      return { admitted: false, refusal: 'missing-token' };
    let verdict: Awaited<ReturnType<IAccessTokenVerifier['verify']>>;
    try {
      verdict = await source.verifier.verify(token);
    } catch {
      verdict = { admitted: false, refusal: 'malformed' };
    }
    if (!source.active) return { admitted: false, refusal: closedRefusal(source) };
    if (!verdict.admitted) return { admitted: false, refusal: verdict.refusal };
    const event = readMessage(isRecord(delivery) ? delivery['event'] : undefined);
    if (typeof event === 'string') return { admitted: false, refusal: event };
    // From here to the submission nothing yields, so two deliveries of one token cannot both pass.
    const at = this.now();
    const claims = spendableClaims(token);
    const replay = this.replayRefusal(source, claims, at);
    if (replay !== undefined) return { admitted: false, refusal: replay };
    if (source.rate.admit(source.grant.grantId) !== undefined)
      return { admitted: false, refusal: 'rate-limited' };
    source.spent.set(claims!.jti, claims!.expiresAt);
    return this.submit(source, event);
  }

  private async submit(source: ISourceState, event: IMessage): Promise<TExternalEventReceipt> {
    const grantId = source.grant.grantId;
    const driverId = `external:${grantId}:${encodeURIComponent(event.conversationId)}`;
    const claimed =
      event.claimedName !== undefined ? ` claimed-name="${escapeXml(event.claimedName)}"` : '';
    const input =
      `<external-event source="${grantId}" conversation="${escapeXml(event.conversationId)}" verified="token"${claimed}>\n` +
      `${escapeXml(event.content)}\n</external-event>`;
    // Hold the guard across submission as well as the completed promise: submit may wait for a turn.
    source.pending += 1;
    this.pending += 1;
    let handle: ITurnHandle;
    try {
      // An idle session runs the turn inside `submit`; the receipt is due at acceptance.
      handle = await new Promise<ITurnHandle>((resolve, reject) => {
        this.host
          .submit(input, {
            turnSource: 'external',
            driverId,
            signal: source.turns.signal,
            onAccepted: resolve,
          })
          .then(resolve, reject);
      });
    } catch {
      source.pending -= 1;
      this.pending -= 1;
      this.maybeRelease(source);
      return {
        admitted: false,
        refusal: this.host.isShuttingDown?.() === true ? 'shutting-down' : 'session-unavailable',
      };
    }
    const settled: Promise<TExternalEventSettlement> = handle.completed
      .then(
        (result): TExternalEventSettlement =>
          result.interrupted
            ? { outcome: 'interrupted' }
            : { outcome: 'completed', response: result.response },
        (error: unknown): TExternalEventSettlement =>
          isTurnNotRunError(error)
            ? { outcome: 'not-run', reason: error.reason }
            : { outcome: 'failed', reason: 'external event turn failed' },
      )
      .then((settlement) => {
        this.record(source, { settlement: settlement.outcome });
        return settlement;
      })
      .finally(() => {
        source.pending -= 1;
        this.pending -= 1;
        this.maybeRelease(source);
      });
    return { admitted: true, turnId: handle.turnId, settled };
  }
}
