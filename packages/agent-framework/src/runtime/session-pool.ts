/**
 * #3189 — the sessions a runtime host keeps live at once, and which client is on which.
 *
 * A host with one current session made every client share it: one client's switch moved them all.
 * The pool lets each client connection hold a binding of its own — a slot that starts on the
 * primary session and moves only when that client switches — while the sessions themselves stay
 * live for as long as someone is on them or they have work in progress.
 *
 * Three rules shape it:
 * - One instance per session id. Two clients opening the same session share it, and so share its
 *   turns, prompts and background tasks; two instances would each write the same stored record.
 * - A session nobody is bound to is shut down only once it is idle. Leaving a session while it
 *   works is allowed, so the pool keeps it until its work ends and a grace period has passed.
 * - A cap on live sessions. It is set by concurrent turns against one provider (rate limits and
 *   spend) and by background processes, not by memory. The primary counts toward it and is never
 *   closed: it holds what belongs to the run.
 */

import { isTerminalBackgroundTaskStatus } from '@robota-sdk/agent-executor';

import { SessionChangeRefusal } from './session-change-refusal.js';
import { SessionSlot, shutdownSessionBounded } from './session-slot.js';

import type {
  IInteractiveSession,
  ISessionLoopState,
  TSessionBindingRole,
} from '@robota-sdk/agent-interface-session';

/** The primary included. */
export const SESSION_POOL_MAX_LIVE = 4;
/** How long a session nobody is bound to stays live once idle. */
export const SESSION_POOL_IDLE_GRACE_MS = 300_000;

/** A binding's role, as the session contracts define it. */
export type TSessionPoolRole = TSessionBindingRole;

/** The members of a session the default busy rule reads; the last two are InteractiveSession's own. */
export type TPoolBusySession = Pick<
  IInteractiveSession,
  'isExecuting' | 'getPendingPrompt' | 'getPendingCount' | 'listBackgroundTasks'
> & {
  /** `needs-input` while a permission or ask prompt waits for an answer. */
  getLocalActivityStatus?(): 'working' | 'needs-input' | 'idle' | undefined;
  listSelfPacedLoops?(): readonly ISessionLoopState[];
};

/**
 * Whether closing this session now would lose work: a running turn, a prompt waiting for an answer,
 * queued messages, a live background task, or a self-paced loop that has not ended.
 */
export function isSessionBusy(session: TPoolBusySession, nowMs = Date.now()): boolean {
  if (session.isExecuting()) return true;
  if (session.getLocalActivityStatus?.() === 'needs-input') return true;
  if (session.getPendingPrompt() !== null || session.getPendingCount() > 0) return true;
  if (session.listBackgroundTasks().some((task) => !isTerminalBackgroundTaskStatus(task.status))) {
    return true;
  }
  // A waiting loop wakes its own session; closed, it would never fire again.
  return (session.listSelfPacedLoops?.() ?? []).some(
    (loop) =>
      loop.phase !== 'stopped' && loop.phase !== 'expired' && Date.parse(loop.expiresAt) > nowMs,
  );
}

export interface ISessionPoolOptions<TSession> {
  /** The session the host started with. Every binding starts on it; only `shutdownAll` closes it. */
  primary: TSession;
  /** Build a session, resuming `resumeSessionId` when given, or a fresh one. */
  build(resumeSessionId?: string): TSession;
  /** Live sessions at most, the primary and sessions still starting included. */
  maxLive?: number;
  /** How long a session nobody is bound to stays live once idle. */
  idleGraceMs?: number;
  /** Whether closing `session` now would lose work; defaults to {@link isSessionBusy}. */
  isBusy?(session: TSession): boolean;
  /** Shut `session` down, bounded; defaults to {@link shutdownSessionBounded}. */
  shutdown?(session: TSession, message: string): Promise<void>;
}

/**
 * A session held for one client between `acquire` and the binding's `moveTo`: while held it is not
 * closed. Hand it to `moveTo`, or `cancel` it when the client does not move after all.
 */
export interface ISessionLease<TSession> {
  readonly session: TSession;
  cancel(): void;
}

/** One client's place in the pool. */
export interface ISessionPoolBinding<TSession extends IInteractiveSession> {
  readonly role: TSessionPoolRole;
  /** The client's session; it follows this binding's moves and no one else's. */
  readonly slot: SessionSlot<TSession>;
  /** Move this binding onto the leased session. Its slot's listeners hear `session_switched`. */
  moveTo(lease: ISessionLease<TSession>): void;
  /** This binding drives, and no other driver is on its session. */
  isLastDriver(): boolean;
  /** The client has gone. Idempotent. */
  release(): void;
}

/** A live session and who is on it. */
export interface ISessionPoolEntry<TSession> {
  readonly sessionId: string;
  readonly session: TSession;
  /** Bindings on it, drivers and observers. */
  readonly clients: number;
  readonly drivers: number;
}

interface IEntry<TSession> {
  /** Read lazily: a session names itself only once initialized. */
  id: string | undefined;
  readonly session: TSession;
  readonly primary: boolean;
  clients: number;
  drivers: number;
  /** Leases not yet moved to or cancelled. */
  holds: number;
  /** When it last gained or lost a client or a lease; the smallest is evicted first. */
  lastActive: number;
  grace: ReturnType<typeof setTimeout> | undefined;
}

interface IBuildState<TSession> {
  readonly key: string;
  readonly session: TSession;
  /** Acquires waiting on this build; each gets a lease once it is live. */
  waiters: number;
  /** `shutdownAll` has already shut this build down. */
  abandoned: boolean;
}

interface IBuild<TSession> extends IBuildState<TSession> {
  readonly ready: Promise<IEntry<TSession>>;
}

interface ILeaseState<TSession> {
  readonly entry: IEntry<TSession>;
  state: 'held' | 'moved' | 'cancelled';
}

const STOPPING_MESSAGE = 'This runtime is stopping.';

export class SessionPool<TSession extends IInteractiveSession> {
  private readonly entries = new Set<IEntry<TSession>>();
  private readonly primaryEntry: IEntry<TSession>;
  /** Builds in flight, by the session id asked for (a fresh build under a key of its own). */
  private readonly building = new Map<string, IBuild<TSession>>();
  /** Shutdowns in flight, by session id; an acquire of that id waits for it. */
  private readonly closing = new Map<string, Promise<void>>();
  private readonly leases = new WeakMap<ISessionLease<TSession>, ILeaseState<TSession>>();
  private readonly maxLive: number;
  private readonly idleGraceMs: number;
  private readonly isBusy: (session: TSession) => boolean;
  private readonly shutdownSession: (session: TSession, message: string) => Promise<void>;
  private clock = 0;
  private freshBuilds = 0;
  private drained: Promise<void> | undefined;

  constructor(private readonly options: ISessionPoolOptions<TSession>) {
    this.maxLive = options.maxLive ?? SESSION_POOL_MAX_LIVE;
    this.idleGraceMs = options.idleGraceMs ?? SESSION_POOL_IDLE_GRACE_MS;
    this.isBusy = options.isBusy ?? ((session) => isSessionBusy(session as TPoolBusySession));
    this.shutdownSession =
      options.shutdown ?? ((session, message) => shutdownSessionBounded(session, message));
    this.primaryEntry = this.register(options.primary, undefined, 0, true);
  }

  /** A binding for one client, on the primary session. */
  bind(role: TSessionPoolRole): ISessionPoolBinding<TSession> {
    let entry = this.primaryEntry;
    let released = false;
    const slot = new SessionSlot<TSession>(entry.session);
    this.join(entry, role);
    return {
      role,
      slot,
      moveTo: (lease) => {
        const held = this.leases.get(lease);
        if (held === undefined || held.state !== 'held') {
          throw new Error('SessionPool: the lease was already used or cancelled.');
        }
        if (released) {
          lease.cancel();
          throw new Error('SessionPool: the binding was released.');
        }
        if (this.drained !== undefined) {
          lease.cancel();
          throw new SessionChangeRefusal('stopping', STOPPING_MESSAGE);
        }
        held.state = 'moved';
        held.entry.holds -= 1;
        if (held.entry === entry) {
          this.touch(entry);
          return;
        }
        const previous = entry;
        entry = held.entry;
        this.join(entry, role);
        this.leave(previous, role);
        slot.moveTo(entry.session);
      },
      isLastDriver: () => !released && role === 'drive' && entry.drivers === 1,
      release: () => {
        if (released) return;
        released = true;
        this.leave(entry, role);
      },
    };
  }

  /**
   * Hold session `sessionId` for a client, or a fresh session when no id is given. A live instance
   * is reused, a build already under way for that id is shared, and an instance still closing is
   * waited for. Refused with `limit` when the pool is full and no session can be closed, with
   * `start_failed` when the session cannot start, and with `stopping` once the pool is shut down.
   */
  async acquire(sessionId?: string): Promise<ISessionLease<TSession>> {
    this.assertOpen();
    if (sessionId !== undefined) {
      await this.namePrimary();
      for (let closing = this.closing.get(sessionId); closing !== undefined;) {
        await closing;
        closing = this.closing.get(sessionId);
      }
      this.assertOpen();
      const live = this.findLive(sessionId);
      if (live !== undefined) {
        live.holds += 1;
        this.touch(live);
        return this.lease(live);
      }
      const building = this.building.get(sessionId);
      if (building !== undefined) {
        building.waiters += 1;
        return this.lease(await building.ready);
      }
    }
    this.makeRoom();
    return this.lease(await this.startBuild(sessionId).ready);
  }

  /** The live sessions that have named themselves, and who is on each. */
  listLive(): ISessionPoolEntry<TSession>[] {
    const rows: ISessionPoolEntry<TSession>[] = [];
    for (const entry of this.entries) {
      const sessionId = this.entryId(entry);
      if (sessionId === undefined) continue;
      rows.push({
        sessionId,
        session: entry.session,
        clients: entry.clients,
        drivers: entry.drivers,
      });
    }
    return rows;
  }

  /** Shut every session down in parallel, each bounded, the primary included. Idempotent. */
  shutdownAll(message = 'runtime host stopped'): Promise<void> {
    if (this.drained !== undefined) return this.drained;
    const shutdowns: Promise<void>[] = [...this.closing.values()];
    for (const entry of this.entries) {
      this.clearGrace(entry);
      shutdowns.push(this.shutdownQuietly(entry.session, message));
    }
    this.entries.clear();
    for (const build of this.building.values()) {
      build.abandoned = true;
      shutdowns.push(this.shutdownQuietly(build.session, message));
    }
    this.building.clear();
    this.drained = Promise.all(shutdowns).then(() => undefined);
    return this.drained;
  }

  private assertOpen(): void {
    if (this.drained !== undefined) throw new SessionChangeRefusal('stopping', STOPPING_MESSAGE);
  }

  private register(
    session: TSession,
    id: string | undefined,
    holds: number,
    primary = false,
  ): IEntry<TSession> {
    const entry: IEntry<TSession> = {
      id,
      session,
      primary,
      clients: 0,
      drivers: 0,
      holds,
      lastActive: (this.clock += 1),
      grace: undefined,
    };
    this.entries.add(entry);
    return entry;
  }

  private entryId(entry: IEntry<TSession>): string | undefined {
    if (entry.id !== undefined) return entry.id;
    try {
      entry.id = entry.session.getSession().getSessionId();
    } catch {
      // allow-fallback: a session still starting cannot name itself yet; it is asked again later.
      return undefined;
    }
    return entry.id;
  }

  /** The primary must be matched by its id, never built twice, so an acquire waits for its name. */
  private async namePrimary(): Promise<void> {
    if (this.entryId(this.primaryEntry) !== undefined) return;
    // allow-fallback: a primary that failed to start names no id; the pool builds the session instead.
    await whenInitialized(this.primaryEntry.session).catch(() => undefined);
  }

  private findLive(sessionId: string): IEntry<TSession> | undefined {
    for (const entry of this.entries) {
      if (this.entryId(entry) === sessionId) return entry;
    }
    return undefined;
  }

  private lease(entry: IEntry<TSession>): ISessionLease<TSession> {
    const held: ILeaseState<TSession> = { entry, state: 'held' };
    const lease: ISessionLease<TSession> = {
      session: entry.session,
      cancel: () => {
        if (held.state !== 'held') return;
        held.state = 'cancelled';
        entry.holds -= 1;
        this.touch(entry);
        this.settle(entry);
      },
    };
    this.leases.set(lease, held);
    return lease;
  }

  private join(entry: IEntry<TSession>, role: TSessionPoolRole): void {
    entry.clients += 1;
    if (role === 'drive') entry.drivers += 1;
    this.touch(entry);
  }

  private leave(entry: IEntry<TSession>, role: TSessionPoolRole): void {
    entry.clients -= 1;
    if (role === 'drive') entry.drivers -= 1;
    this.touch(entry);
    this.settle(entry);
  }

  private touch(entry: IEntry<TSession>): void {
    entry.lastActive = this.clock += 1;
    this.clearGrace(entry);
  }

  /** Start the idle grace of a session nobody is on or about to be on. */
  private settle(entry: IEntry<TSession>): void {
    if (entry.primary || entry.clients > 0 || entry.holds > 0) return;
    if (this.drained !== undefined || !this.entries.has(entry)) return;
    this.clearGrace(entry);
    const grace = setTimeout(() => {
      entry.grace = undefined;
      if (!this.entries.has(entry) || entry.clients > 0 || entry.holds > 0) return;
      if (this.busy(entry)) {
        this.settle(entry);
        return;
      }
      this.close(entry, 'session idle with no client');
    }, this.idleGraceMs);
    // The grace is housekeeping: it must never be what keeps the process alive.
    grace.unref?.();
    entry.grace = grace;
  }

  private clearGrace(entry: IEntry<TSession>): void {
    if (entry.grace === undefined) return;
    clearTimeout(entry.grace);
    entry.grace = undefined;
  }

  private busy(entry: IEntry<TSession>): boolean {
    try {
      return this.isBusy(entry.session);
    } catch {
      // allow-fallback: a session whose state cannot be read is not closed out from under its work.
      return true;
    }
  }

  /** Close the oldest idle session nobody is on when the pool is full; refuse when none can go. */
  private makeRoom(): void {
    if (this.entries.size + this.building.size < this.maxLive) return;
    let oldest: IEntry<TSession> | undefined;
    for (const entry of this.entries) {
      if (entry.primary || entry.clients > 0 || entry.holds > 0 || this.busy(entry)) continue;
      if (oldest === undefined || entry.lastActive < oldest.lastActive) oldest = entry;
    }
    if (oldest === undefined) {
      throw new SessionChangeRefusal(
        'limit',
        `${this.maxLive} sessions are live, the most this runtime keeps, and none of them can be ` +
          'closed now: each has a client on it or work in progress.',
      );
    }
    this.close(oldest, 'session closed to make room for another');
  }

  private close(entry: IEntry<TSession>, message: string): void {
    this.clearGrace(entry);
    this.entries.delete(entry);
    this.trackClosing(this.entryId(entry), this.shutdownQuietly(entry.session, message));
  }

  private trackClosing(sessionId: string | undefined, done: Promise<void>): void {
    const key = sessionId ?? `\0closing#${(this.clock += 1)}`;
    const tracked = done.then(() => {
      if (this.closing.get(key) === tracked) this.closing.delete(key);
    });
    this.closing.set(key, tracked);
  }

  private shutdownQuietly(session: TSession, message: string): Promise<void> {
    // allow-fallback: a session being closed is left behind either way; its shutdown cannot fail the pool.
    return this.shutdownSession(session, message).catch(() => undefined);
  }

  private startBuild(sessionId: string | undefined): IBuild<TSession> {
    let session: TSession;
    try {
      session = this.options.build(sessionId);
    } catch (error) {
      throw startFailed(error);
    }
    const key = sessionId ?? `\0new#${(this.freshBuilds += 1)}`;
    const state: IBuildState<TSession> = { key, session, waiters: 1, abandoned: false };
    // One object: `shutdownAll` marks the map's build abandoned, and `finishBuild` reads the mark.
    const build: IBuild<TSession> = Object.assign(state, {
      ready: this.finishBuild(state, sessionId),
    });
    this.building.set(key, build);
    return build;
  }

  private async finishBuild(
    build: IBuildState<TSession>,
    sessionId: string | undefined,
  ): Promise<IEntry<TSession>> {
    try {
      await whenInitialized(build.session);
    } catch (error) {
      this.building.delete(build.key);
      if (build.abandoned) throw new SessionChangeRefusal('stopping', STOPPING_MESSAGE);
      const done = this.shutdownQuietly(build.session, 'session failed to start');
      this.trackClosing(sessionId, done);
      await done;
      throw startFailed(error);
    }
    this.building.delete(build.key);
    if (build.abandoned) throw new SessionChangeRefusal('stopping', STOPPING_MESSAGE);
    return this.register(build.session, sessionId, build.waiters);
  }
}

/** Resolves once `session` has started, for a session that says when; a sync throw rejects too. */
async function whenInitialized(session: unknown): Promise<void> {
  const ready = (session as { whenInitialized?: () => Promise<void> }).whenInitialized;
  if (typeof ready === 'function') await ready.call(session);
}

function startFailed(error: unknown): SessionChangeRefusal {
  const reason = error instanceof Error ? error.message : String(error);
  return new SessionChangeRefusal('start_failed', `The session could not be started: ${reason}`);
}
