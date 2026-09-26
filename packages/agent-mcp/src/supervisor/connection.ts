/**
 * Connection and catalog lifecycle supervisor (MCP-002, absorbing MCP-003).
 *
 * Owns open / reuse / close, ALL retry state, the four typed timeouts, `list_changed` refresh without
 * reconnecting, the last-known-good catalog with explicit identity, and — the SSOT the package
 * asserts at package scope (TC-23) — the ONE connection-state union, `TMCPConnectionState`.
 * `../client/session.ts` is stateless about liveness by contract.
 *
 * Contract file: the types below are authoritative; `MCPConnectionSupervisor` is completed against
 * them (TC-09, TC-10, TC-13 … TC-17, TC-22).
 */

import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

import { catalogIdentityOf, sameCatalogIdentity } from '../catalog/types.js';
import { MCPAuthenticationError } from '../client/authentication.js';
import { MCPSessionError } from '../client/session.js';
import { MCPStdioError } from '../client/stdio-transport.js';
import {
  MCPTransportRedirectRefusedError,
  MCPTransportResponseLimitError,
} from '../client/transport.js';

import type {
  IMCPCatalogIdentity,
  IMCPDiscovery,
  IMCPServerIdentity,
  TMCPCapabilityDomain,
} from '../catalog/types.js';
import type { IMCPSession, IMCPToolCallResult } from '../client/session.js';
import type { IOutboundTraceContext, TToolParameters } from '@robota-sdk/agent-core';

/** Default page bound for a `discover`/`refresh` call that does not override `options.discovery`. */
const DEFAULT_DISCOVERY_MAX_PAGES = 50;

/** The HTTP status range `extractHttpStatus` accepts as a genuine status code (inclusive/exclusive). */
const HTTP_STATUS_RANGE_MIN = 100;
const HTTP_STATUS_RANGE_MAX_EXCLUSIVE = 600;

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_SERVER_ERROR_MAX_EXCLUSIVE = 600;

const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;

/** Only `transient` is ever retried; the other three are refused on first response (TC-13). */
export type TMCPFailureClass = 'transient' | 'auth' | 'config' | 'not-found';

/** Five DISTINCT typed settings; setting one never changes another (TC-16, TC-18). */
export interface IMCPTimeouts {
  readonly startupMs: number;
  readonly perCallMs: number;
  readonly globalDefaultMs: number;
  readonly idleMs: number;
  /**
   * The budget of one `callTool` request. Distinct from `perCallMs`, which stays the per-request
   * timeout for discovery and protocol calls; `callTool` uses `toolCallMs` instead.
   */
  readonly toolCallMs: number;
}

export interface IMCPBackoffPolicy {
  readonly initialMs: number;
  readonly maxMs: number;
  readonly factor: number;
  readonly maxAttempts: number;
}

/**
 * THE connection-state union. The `failed` member carries its classification so a caller reads it
 * rather than re-deriving it (TC-10); its presence is required by the type (TC-23).
 */
export type TMCPConnectionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting'; readonly attempt: number }
  | { readonly kind: 'connected'; readonly identity: IMCPServerIdentity }
  | {
      readonly kind: 'failed';
      readonly classification: TMCPFailureClass;
      readonly message: string;
      readonly attempt: number;
      /** `pending` while a bounded backoff timer is armed; `manual-retry` once the bound is reached. */
      readonly retry: 'pending' | 'manual-retry';
    }
  | { readonly kind: 'closed' };

/**
 * A timer handle as this package's clock seam hands it back: the real clock returns Node's
 * `ReturnType<typeof setTimeout>`; a fake clock (`../__tests__/supervisor-test-helpers.ts`) is free
 * to return a plain `number` id instead — both are opaque to every caller, which only ever passes
 * one back to `clearTimeout`.
 */
export type TMCPTimerHandle = ReturnType<typeof setTimeout> | number;

/** Injected so retry timing is deterministic under a fake clock; never polled in the foreground (TC-14). */
export interface IMCPSupervisorClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): TMCPTimerHandle;
  clearTimeout(handle: TMCPTimerHandle): void;
}

export interface IMCPLastKnownGood {
  readonly identity: IMCPCatalogIdentity;
  readonly discovery: IMCPDiscovery;
  readonly retainedAt: number;
  /** Per domain: `true` after a `list_changed` until a refresh succeeds, or after a refresh fails. */
  readonly stale: Readonly<Record<TMCPCapabilityDomain, boolean>>;
  readonly lastError?: { readonly classification: TMCPFailureClass; readonly message: string };
}

export interface IMCPConnectionSupervisorOptions {
  readonly serverId: string;
  /** Opens a NEW session over an already-admitted transport; the supervisor decides when. */
  readonly openSession: (signal: AbortSignal) => Promise<IMCPSession>;
  readonly timeouts: IMCPTimeouts;
  readonly backoff?: Partial<IMCPBackoffPolicy>;
  readonly clock?: IMCPSupervisorClock;
  readonly discovery?: { readonly maxPages: number };
  readonly onStateChange?: (state: TMCPConnectionState) => void;
  /** Stdio owns bounded child cleanup; wait for it after startup/global timeout and shutdown. */
  readonly awaitOpenCleanupOnTimeout?: boolean;
}

export const DEFAULT_MCP_BACKOFF: IMCPBackoffPolicy = {
  initialMs: 500,
  maxMs: 30_000,
  factor: 2,
  maxAttempts: 5,
};

const REAL_CLOCK: IMCPSupervisorClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function freshStale(): Record<TMCPCapabilityDomain, boolean> {
  return { tools: false, prompts: false, resources: false };
}

function readUnknownProperty(value: unknown, key: string): unknown {
  if (typeof value === 'object' && value !== null && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/** HTTP status, whether reported as `.status`, `.statusCode`, or the SDK's `StreamableHTTPError.code`. */
function extractHttpStatus(error: unknown): number | undefined {
  const status = readUnknownProperty(error, 'status');
  if (typeof status === 'number') {
    return status;
  }
  const statusCode = readUnknownProperty(error, 'statusCode');
  if (typeof statusCode === 'number') {
    return statusCode;
  }
  const code = readUnknownProperty(error, 'code');
  if (
    typeof code === 'number' &&
    code >= HTTP_STATUS_RANGE_MIN &&
    code < HTTP_STATUS_RANGE_MAX_EXCLUSIVE
  ) {
    return code;
  }
  return undefined;
}

/** Node's `NodeJS.ErrnoException.code`, e.g. `ECONNREFUSED`. */
function extractErrnoCode(error: unknown): string | undefined {
  const code = readUnknownProperty(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

/** JSON-RPC error codes are negative by spec, so they never collide with an HTTP status. */
function extractJsonRpcCode(error: unknown): number | undefined {
  const code = readUnknownProperty(error, 'code');
  if (typeof code === 'number' && code < 0) {
    return code;
  }
  const nestedCode = readUnknownProperty(readUnknownProperty(error, 'data'), 'code');
  return typeof nestedCode === 'number' ? nestedCode : undefined;
}

function isAuthFailure(status: number | undefined, message: string): boolean {
  return (
    status === HTTP_UNAUTHORIZED ||
    status === HTTP_FORBIDDEN ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized')
  );
}

function isNotFoundFailure(
  status: number | undefined,
  rpcCode: number | undefined,
  message: string,
): boolean {
  return (
    status === HTTP_NOT_FOUND ||
    rpcCode === JSON_RPC_METHOD_NOT_FOUND ||
    message.includes('not found')
  );
}

function isConfigurationFailure(
  error: unknown,
  rpcCode: number | undefined,
  message: string,
): boolean {
  return (
    rpcCode === JSON_RPC_INVALID_PARAMS ||
    message.includes('invalid url') ||
    message.includes('unsupported protocol') ||
    message.includes('invalid params')
  );
}

function isTransientFailure(
  status: number | undefined,
  errnoCode: string | undefined,
  message: string,
): boolean {
  return (
    (typeof status === 'number' &&
      status >= HTTP_SERVER_ERROR_MIN &&
      status < HTTP_SERVER_ERROR_MAX_EXCLUSIVE) ||
    errnoCode === 'ECONNREFUSED' ||
    errnoCode === 'ECONNRESET' ||
    errnoCode === 'ETIMEDOUT' ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('network')
  );
}

/** Classify a thrown failure; owned here so every caller reads one answer (TC-13). */
export function classifyMcpFailure(error: unknown): TMCPFailureClass {
  if (error instanceof MCPSupervisorError) return error.classification;
  // Typed refusals first: a redirect refusal embeds the `Location` text in its message, so it must
  // never reach the message heuristics below (a target path containing "unauthorized" is not auth).
  if (
    error instanceof MCPTransportRedirectRefusedError ||
    error instanceof MCPTransportResponseLimitError
  ) {
    return 'config';
  }
  if (
    error instanceof MCPStdioError &&
    (error.reason === 'authority' ||
      error.reason === 'cleanup' ||
      error.reason === 'receive-limit' ||
      error.reason === 'receive-invalid')
  ) {
    return 'config';
  }
  if (error instanceof UnauthorizedError || error instanceof MCPAuthenticationError) {
    return 'auth';
  }
  if (error instanceof MCPSessionError && error.kind === 'unsupported-protocol-version') {
    return 'config';
  }

  const message = extractErrorMessage(error).toLowerCase();
  const status = extractHttpStatus(error);
  const errnoCode = extractErrnoCode(error);
  const rpcCode = extractJsonRpcCode(error);

  if (isAuthFailure(status, message)) {
    return 'auth';
  }
  if (isNotFoundFailure(status, rpcCode, message)) {
    return 'not-found';
  }
  if (isConfigurationFailure(error, rpcCode, message)) {
    return 'config';
  }
  if (isTransientFailure(status, errnoCode, message)) {
    return 'transient';
  }

  // Unrecognised shapes default to `transient`: a bounded number of retries is the safe assumption
  // for an error this classifier cannot name, versus permanently refusing on an unknown cause.
  return 'transient';
}

/**
 * Thrown by `callTool` (and internally by `discover`/`refresh`) so the caller reads the classification
 * off the thrown value itself rather than re-deriving it (TC-10). A class, not a union member — it is
 * not a second connection-state model.
 */
export class MCPSupervisorError extends Error {
  constructor(
    readonly classification: TMCPFailureClass,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = 'MCPSupervisorError';
  }
}

/**
 * A background attempt's settlement, carried as VALUE rather than as a promise rejection — the point
 * of this type is that nothing awaiting `pendingAttempt` (directly or transitively, e.g. a
 * backoff-armed retry with no caller awaiting it at all) can produce an unhandled rejection, because
 * the promise it settles never rejects.
 */
type TMCPAttemptOutcome =
  | { readonly ok: true; readonly session: IMCPSession }
  | { readonly ok: false; readonly error: MCPSupervisorError };

export class MCPConnectionSupervisor {
  private state: TMCPConnectionState = { kind: 'idle' };
  private readonly backoff: IMCPBackoffPolicy;
  private readonly clock: IMCPSupervisorClock;

  private liveSession: IMCPSession | undefined;
  private lastKnownGood: IMCPLastKnownGood | undefined;
  private lastBackgroundRefreshFailure:
    | { readonly domain: TMCPCapabilityDomain; readonly message: string; readonly at: number }
    | undefined;
  private lastBackgroundCloseFailure: { readonly message: string; readonly at: number } | undefined;

  private pendingAttempt: Promise<TMCPAttemptOutcome> | undefined;
  private resolvePendingRetry: ((outcome: TMCPAttemptOutcome) => void) | undefined;
  private activeAbortController: AbortController | undefined;
  private retryTimerHandle: TMCPTimerHandle | undefined;
  private idleTimerHandle: TMCPTimerHandle | undefined;
  private unsubscribeListChanged: (() => void) | undefined;
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly options: IMCPConnectionSupervisorOptions) {
    this.backoff = { ...DEFAULT_MCP_BACKOFF, ...options.backoff };
    this.clock = options.clock ?? REAL_CLOCK;
  }

  getState(): TMCPConnectionState {
    return this.state;
  }

  /** Open if idle/failed(manual-retry)/closed, otherwise reuse the live session. */
  async ensureConnected(signal?: AbortSignal): Promise<IMCPSession> {
    const state = this.state;

    if (state.kind === 'connected') {
      this.noteActivity();
      return this.liveSession as IMCPSession;
    }
    if (state.kind === 'closed') {
      throw new Error(
        'MCPConnectionSupervisor is shut down; it cannot reconnect (create a new instance)',
      );
    }
    if (state.kind === 'connecting') {
      return this.expectPendingAttempt();
    }
    if (state.kind === 'failed') {
      if (state.retry === 'pending') {
        return this.expectPendingAttempt();
      }
      // `manual-retry`: never auto-opened — that is `retry()`'s job.
      throw new MCPSupervisorError(
        state.classification,
        `connection failed (${state.classification}): ${state.message}; call retry() explicitly`,
      );
    }

    // idle
    return this.beginConnect(1, signal);
  }

  /** Full discovery; retains the result as last-known-good bound to the session identity. */
  async discover(signal?: AbortSignal): Promise<IMCPDiscovery> {
    return this.withDefaultBudget(signal, async (effectiveSignal) => {
      const session = await this.ensureConnected(effectiveSignal);
      this.noteActivity();
      let discovery: IMCPDiscovery;
      try {
        discovery = await session.discover({
          maxPages: this.options.discovery?.maxPages ?? DEFAULT_DISCOVERY_MAX_PAGES,
          perRequestTimeoutMs: this.options.timeouts.perCallMs,
          signal: effectiveSignal,
        });
      } catch (error) {
        this.retireSelfClosedStdioSession(session, error);
        throw error;
      }
      this.lastKnownGood = {
        identity: catalogIdentityOf(session.identity),
        discovery,
        retainedAt: this.clock.now(),
        stale: freshStale(),
      };
      return discovery;
    });
  }

  /** Re-list ONE domain over the live session — never reconnects; on failure keeps last-known-good and marks it stale. */
  async refresh(domain: TMCPCapabilityDomain, signal?: AbortSignal): Promise<IMCPDiscovery> {
    return this.withDefaultBudget(signal, async (effectiveSignal) => {
      const session = await this.ensureConnected(effectiveSignal);
      this.noteActivity();
      try {
        // `IMCPSession.discover` has no per-domain filter in its contract (`../client/session.ts`), so
        // a single-domain refresh is implemented by re-listing every domain over the SAME live session
        // and keeping only the one domain asked for. What TC-15 requires is "no reconnect" — asserted
        // by `openSession` having been called exactly once across the whole test — not a smaller
        // request.
        const full = await session.discover({
          maxPages: this.options.discovery?.maxPages ?? DEFAULT_DISCOVERY_MAX_PAGES,
          perRequestTimeoutMs: this.options.timeouts.perCallMs,
          signal: effectiveSignal,
        });
        return this.recordRefreshSuccess(domain, session.identity, full);
      } catch (error) {
        this.retireSelfClosedStdioSession(session, error);
        const classification = classifyMcpFailure(error);
        const message = extractErrorMessage(error);
        this.recordRefreshFailure(domain, classification, message);
        throw new MCPSupervisorError(classification, message, { cause: error });
      }
    });
  }

  async callTool(
    name: string,
    args: TToolParameters,
    options?: {
      readonly signal?: AbortSignal;
      readonly outboundTraceContext?: IOutboundTraceContext;
    },
  ): Promise<IMCPToolCallResult> {
    return this.withDefaultBudget(options?.signal, async (effectiveSignal) => {
      const session = await this.ensureConnected(effectiveSignal);
      this.noteActivity();
      try {
        // Retries are for CONNECTIONS only: a transient tool-call failure is classified and thrown,
        // never retried here.
        return await session.callTool(name, args, {
          signal: effectiveSignal,
          timeoutMs: this.options.timeouts.toolCallMs,
          ...(options?.outboundTraceContext
            ? { outboundTraceContext: options.outboundTraceContext }
            : {}),
        });
      } catch (error) {
        this.retireSelfClosedStdioSession(session, error);
        const classification = classifyMcpFailure(error);
        const message = extractErrorMessage(error);
        throw new MCPSupervisorError(classification, message, { cause: error });
      }
    });
  }

  getLastKnownGood(): IMCPLastKnownGood | undefined {
    return this.lastKnownGood;
  }

  /** The most recent `list_changed`-triggered background refresh failure, if any (never thrown — see `refreshInBackground`). */
  get lastRefreshFailure():
    | { readonly domain: TMCPCapabilityDomain; readonly message: string; readonly at: number }
    | undefined {
    return this.lastBackgroundRefreshFailure;
  }

  /**
   * The most recent close failure recorded from a background close — one with no caller awaiting
   * it directly, e.g. the idle-timeout close (`handleIdleTimeout`) or the close of a session that
   * finished opening after `shutdown()` already moved the state to `closed` (`runOpenAttempt`).
   * Never thrown, for the same reason as `lastRefreshFailure`.
   */
  get lastCloseFailure(): { readonly message: string; readonly at: number } | undefined {
    return this.lastBackgroundCloseFailure;
  }

  /** Explicit operator action after `manual-retry`. */
  async retry(signal?: AbortSignal): Promise<IMCPSession> {
    const state = this.state;

    if (state.kind === 'connected') {
      this.noteActivity();
      return this.liveSession as IMCPSession;
    }
    if (state.kind === 'closed') {
      throw new Error(
        'MCPConnectionSupervisor is shut down; it cannot reconnect (create a new instance)',
      );
    }
    if (state.kind === 'connecting' || (state.kind === 'failed' && state.retry === 'pending')) {
      return this.expectPendingAttempt();
    }

    // idle, or failed(manual-retry): start a fresh attempt cycle.
    return this.beginConnect(1, signal);
  }

  /** Cancels any armed timer, closes the session and its transport; leaves no live request (TC-17). */
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.shutdownPromise = this.shutdownOwned();
    return this.shutdownPromise;
  }

  private async shutdownOwned(): Promise<void> {
    if (this.state.kind === 'closed') {
      return;
    }

    this.clearRetryTimer();
    this.clearIdleTimer();
    this.activeAbortController?.abort();
    this.activeAbortController = undefined;
    const pending = this.pendingAttempt;
    this.pendingAttempt = undefined;

    if (this.unsubscribeListChanged) {
      this.unsubscribeListChanged();
      this.unsubscribeListChanged = undefined;
    }

    const session = this.liveSession;
    this.liveSession = undefined;
    this.setState({ kind: 'closed' });

    if (session) {
      await session.close();
    }
    if (this.options.awaitOpenCleanupOnTimeout && pending) {
      const outcome = await pending;
      if (
        !outcome.ok &&
        outcome.error.cause instanceof MCPStdioError &&
        outcome.error.cause.reason === 'cleanup'
      ) {
        throw outcome.error;
      }
    }
  }

  // ---- internal helpers -----------------------------------------------------------------------

  private setState(next: TMCPConnectionState): void {
    this.state = next;
    this.options.onStateChange?.(next);
  }

  private expectPendingAttempt(): Promise<IMCPSession> {
    const pending = this.pendingAttempt;
    if (!pending) {
      throw new Error(
        'MCPConnectionSupervisor invariant violated: no attempt is pending for this state',
      );
    }
    return this.settle(pending);
  }

  private noteActivity(): void {
    if (this.state.kind === 'connected') {
      this.armIdleTimer();
    }
  }

  /** Applies `globalDefaultMs` as the default abort budget only when the caller supplied no `signal`. */
  private withDefaultBudget<T>(
    signal: AbortSignal | undefined,
    run: (effectiveSignal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    if (signal) {
      return run(signal);
    }
    const controller = new AbortController();
    return this.withTimeout(
      run(controller.signal),
      this.options.timeouts.globalDefaultMs,
      () => controller.abort(),
      this.options.awaitOpenCleanupOnTimeout,
    );
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    onTimeout?: () => void,
    awaitSettlement = false,
    onLateValue?: (value: T) => Promise<void>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      const timerHandle = this.clock.setTimeout(() => {
        if (settled) {
          return;
        }
        if (awaitSettlement) timedOut = true;
        else settled = true;
        onTimeout?.();
        if (!awaitSettlement) reject(new Error(`operation timed out after ${ms}ms`));
      }, ms);
      promise.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          this.clock.clearTimeout(timerHandle);
          if (timedOut) {
            if (onLateValue) {
              try {
                void onLateValue(value).then(
                  () => reject(new Error(`operation timed out after ${ms}ms`)),
                  reject,
                );
              } catch (error) {
                reject(error);
              }
            } else reject(new Error(`operation timed out after ${ms}ms`));
          } else resolve(value);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          this.clock.clearTimeout(timerHandle);
          reject(error);
        },
      );
    });
  }

  /** Awaits a background attempt's settlement and re-raises its failure as a rejection for the caller. */
  private async settle(outcome: Promise<TMCPAttemptOutcome>): Promise<IMCPSession> {
    const result = await outcome;
    if (!result.ok) {
      throw result.error;
    }
    return result.session;
  }

  private beginConnect(attempt: number, signal?: AbortSignal): Promise<IMCPSession> {
    return this.settle(this.startAttempt(attempt, signal));
  }

  /**
   * Starts a new open attempt and records it as `pendingAttempt`. Never rejects — a backoff-scheduled
   * attempt may settle with nobody awaiting it directly, so its failure is carried as `TMCPAttemptOutcome`
   * state rather than as a promise rejection; `settle()` re-raises it for a caller that IS awaiting.
   */
  private startAttempt(attempt: number, signal?: AbortSignal): Promise<TMCPAttemptOutcome> {
    this.setState({ kind: 'connecting', attempt });

    const controller = new AbortController();
    this.activeAbortController = controller;
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const attemptPromise = this.runOpenAttempt(attempt, controller);
    this.pendingAttempt = attemptPromise;

    return attemptPromise;
  }

  private async runOpenAttempt(
    attempt: number,
    controller: AbortController,
  ): Promise<TMCPAttemptOutcome> {
    try {
      const session = await this.withTimeout(
        this.options.openSession(controller.signal),
        this.options.timeouts.startupMs,
        () => controller.abort(),
        this.options.awaitOpenCleanupOnTimeout,
        (lateSession) => lateSession.close(),
      );
      this.clearActiveController(controller);
      if (this.state.kind === 'closed' || controller.signal.aborted) {
        // `shutdown()` moved the state to `closed` (or aborted this very attempt) while the open
        // was still settling. The session that just arrived was never announced — closing it here,
        // rather than calling `onConnected`, is what keeps a post-shutdown open from resurrecting a
        // connection nothing asked for.
        try {
          await session.close();
        } catch (error) {
          if (this.options.awaitOpenCleanupOnTimeout) {
            const cleanup =
              error instanceof MCPStdioError && error.reason === 'cleanup'
                ? error
                : new MCPStdioError('cleanup');
            return {
              ok: false,
              error: new MCPSupervisorError('config', cleanup.message, { cause: cleanup }),
            };
          }
          this.recordBackgroundCloseFailure(error);
        }
        return {
          ok: false,
          error: new MCPSupervisorError(
            'config',
            'supervisor was shut down while the open attempt was settling',
          ),
        };
      }
      this.onConnected(session);
      return { ok: true, session };
    } catch (error) {
      this.clearActiveController(controller);
      const classification = classifyMcpFailure(error);
      const message = extractErrorMessage(error);
      this.recordOpenFailure(attempt, classification, message);
      return {
        ok: false,
        error: new MCPSupervisorError(classification, message, { cause: error }),
      };
    }
  }

  private clearActiveController(controller: AbortController): void {
    if (this.activeAbortController === controller) {
      this.activeAbortController = undefined;
    }
  }

  private retireSelfClosedStdioSession(session: IMCPSession, error: unknown): void {
    if (
      !(error instanceof MCPStdioError) ||
      (error.reason !== 'cancelled' &&
        error.reason !== 'cleanup' &&
        error.reason !== 'early-exit' &&
        error.reason !== 'receive-limit' &&
        error.reason !== 'receive-invalid') ||
      this.liveSession !== session ||
      this.state.kind === 'closed'
    )
      return;
    this.clearIdleTimer();
    this.unsubscribeListChanged?.();
    this.unsubscribeListChanged = undefined;
    this.liveSession = undefined;
    if (error.reason === 'cleanup') {
      this.setState({
        kind: 'failed',
        classification: 'config',
        message: error.message,
        attempt: 1,
        retry: 'manual-retry',
      });
    } else {
      this.setState({ kind: 'idle' });
    }
  }

  private recordOpenFailure(
    attempt: number,
    classification: TMCPFailureClass,
    message: string,
  ): void {
    // `shutdown()` may have aborted this very attempt; don't resurrect a `failed` state over it.
    if (this.state.kind === 'closed') {
      return;
    }
    if (classification === 'transient' && attempt < this.backoff.maxAttempts) {
      const delay = Math.min(
        this.backoff.maxMs,
        this.backoff.initialMs * Math.pow(this.backoff.factor, attempt - 1),
      );
      this.setState({ kind: 'failed', classification, message, attempt, retry: 'pending' });
      this.armRetryTimer(attempt, delay);
    } else {
      this.setState({ kind: 'failed', classification, message, attempt, retry: 'manual-retry' });
    }
  }

  private onConnected(session: IMCPSession): void {
    const newIdentity = catalogIdentityOf(session.identity);
    if (this.lastKnownGood && !sameCatalogIdentity(this.lastKnownGood.identity, newIdentity)) {
      // TC-22: a reconnect whose identity differs invalidates the retained catalog; nothing is
      // inferred from a stale session id.
      this.lastKnownGood = undefined;
    }

    this.liveSession = session;
    this.pendingAttempt = undefined;
    this.clearRetryTimer();
    this.unsubscribeListChanged = session.onListChanged((domain) => this.handleListChanged(domain));
    this.setState({ kind: 'connected', identity: session.identity });
    this.armIdleTimer();
  }

  private handleListChanged(domain: TMCPCapabilityDomain): void {
    if (this.lastKnownGood) {
      // TC-09: mark the affected domain stale immediately; `refresh` below resolves it either way.
      this.lastKnownGood = {
        ...this.lastKnownGood,
        stale: { ...this.lastKnownGood.stale, [domain]: true },
      };
    }
    void this.refreshInBackground(domain);
  }

  /**
   * A `list_changed` refresh has no caller awaiting it. Its failure is not dropped and not a fallback:
   * `refresh()` already marked the domain stale, and the rejection is recorded as STATE
   * (`lastBackgroundRefreshFailure`, readable via `lastRefreshFailure`) so a consumer can observe it.
   */
  private refreshInBackground(domain: TMCPCapabilityDomain): Promise<void> {
    return this.refresh(domain).then(
      () => undefined,
      (error: unknown) => this.recordBackgroundRefreshFailure(domain, error),
    );
  }

  private recordBackgroundRefreshFailure(domain: TMCPCapabilityDomain, error: unknown): void {
    this.lastBackgroundRefreshFailure = {
      domain,
      message: extractErrorMessage(error),
      at: this.clock.now(),
    };
  }

  private recordBackgroundCloseFailure(error: unknown): void {
    this.lastBackgroundCloseFailure = {
      message: extractErrorMessage(error),
      at: this.clock.now(),
    };
  }

  private recordRefreshSuccess(
    domain: TMCPCapabilityDomain,
    identity: IMCPServerIdentity,
    full: IMCPDiscovery,
  ): IMCPDiscovery {
    const catalogIdentity = catalogIdentityOf(identity);
    const prior =
      this.lastKnownGood && sameCatalogIdentity(this.lastKnownGood.identity, catalogIdentity)
        ? this.lastKnownGood
        : undefined;
    const mergedDiscovery = mergeDomain(prior?.discovery, domain, full);
    const stale: Record<TMCPCapabilityDomain, boolean> = {
      ...(prior?.stale ?? freshStale()),
      [domain]: false,
    };
    this.lastKnownGood = {
      identity: catalogIdentity,
      discovery: mergedDiscovery,
      retainedAt: this.clock.now(),
      stale,
    };
    return mergedDiscovery;
  }

  private recordRefreshFailure(
    domain: TMCPCapabilityDomain,
    classification: TMCPFailureClass,
    message: string,
  ): void {
    if (!this.lastKnownGood) {
      return;
    }
    this.lastKnownGood = {
      ...this.lastKnownGood,
      stale: { ...this.lastKnownGood.stale, [domain]: true },
      lastError: { classification, message },
    };
  }

  private armRetryTimer(attempt: number, delay: number): void {
    this.clearRetryTimer();
    this.pendingAttempt = new Promise<TMCPAttemptOutcome>((resolve) => {
      this.resolvePendingRetry = resolve;
    });
    this.retryTimerHandle = this.clock.setTimeout(() => {
      this.retryTimerHandle = undefined;
      const resolve = this.resolvePendingRetry;
      this.resolvePendingRetry = undefined;
      const next = this.startAttempt(attempt + 1);
      void next.then((outcome) => resolve?.(outcome));
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimerHandle !== undefined) {
      this.clock.clearTimeout(this.retryTimerHandle);
      this.retryTimerHandle = undefined;
    }
    if (this.resolvePendingRetry) {
      this.resolvePendingRetry({
        ok: false,
        error: new MCPSupervisorError('config', 'MCP connection recovery was cancelled'),
      });
      this.resolvePendingRetry = undefined;
    }
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimerHandle = this.clock.setTimeout(() => {
      this.idleTimerHandle = undefined;
      void this.handleIdleTimeout();
    }, this.options.timeouts.idleMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimerHandle !== undefined) {
      this.clock.clearTimeout(this.idleTimerHandle);
      this.idleTimerHandle = undefined;
    }
  }

  private async handleIdleTimeout(): Promise<void> {
    const session = this.liveSession;
    this.liveSession = undefined;
    if (this.unsubscribeListChanged) {
      this.unsubscribeListChanged();
      this.unsubscribeListChanged = undefined;
    }
    this.setState({ kind: 'idle' });
    if (session) {
      // No caller is awaiting this close (armed by a timer, not a request) — mirrors
      // `refreshInBackground`: the failure is recorded as state (`lastCloseFailure`) rather than
      // left to reject an unhandled promise.
      await session.close().then(
        () => undefined,
        (error: unknown) => this.recordBackgroundCloseFailure(error),
      );
    }
  }
}

/** Replaces one domain (and the top-level identity/instructions) in `base` with `source`'s copy. */
function mergeDomain(
  base: IMCPDiscovery | undefined,
  domain: TMCPCapabilityDomain,
  source: IMCPDiscovery,
): IMCPDiscovery {
  if (!base) {
    return source;
  }
  switch (domain) {
    case 'tools':
      return {
        ...base,
        identity: source.identity,
        instructions: source.instructions,
        tools: source.tools,
      };
    case 'prompts':
      return {
        ...base,
        identity: source.identity,
        instructions: source.instructions,
        prompts: source.prompts,
      };
    case 'resources':
      return {
        ...base,
        identity: source.identity,
        instructions: source.instructions,
        resources: source.resources,
      };
  }
}
