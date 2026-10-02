/**
 * #3189 — the sessions a served runtime keeps, one view of them per client.
 *
 * `the product --serve` keeps several sessions live in a pool. Each client connection binds to it and
 * gets a view of its own: its directory lists the workspace's stored sessions, says which one THIS
 * client is on and which are live, and a switch or a new session moves this client alone. Leaving a
 * session that is working does not stop that work: the pool keeps the session running. A change is
 * refused only where carrying it out would leave something no one can finish — a prompt that only
 * this client could answer — and a refusal says why with a code the client can branch on.
 */

import {
  SessionChangeRefusal,
  SessionDeleteRefusal,
  isSessionBusy,
  listResumableSessionSummaries,
  listUnreadableSessionsForWorkspace,
  persistSessionRename,
  resolveReusableEmptySessionId,
} from '@robota-sdk/agent-framework';

import type {
  IInteractiveSession,
  IInteractiveSessionStore,
  ISessionBinder,
  ISessionBinding,
  ISessionDirectory,
  ISessionListing,
  ISessionListingEntry,
  ISessionLoopState,
  TSessionBindingRole,
} from '@robota-sdk/agent-interface-session';

/**
 * The members of a session the directory reads: its id, whether a prompt waits on it, and — #3289
 * §1 — everything {@link isSessionBusy} needs to tell a session with work in progress (a running
 * turn, a pending prompt, a live background task, an unexpired self-paced loop) from one it may
 * delete. `listSelfPacedLoops` stays optional, exactly as `isSessionBusy` itself takes it, because it
 * is not part of the base session capability set.
 */
export type TServeDirectorySession = Pick<
  IInteractiveSession,
  'getSession' | 'isExecuting' | 'getPendingPrompt' | 'getPendingCount' | 'listBackgroundTasks'
> & {
  /** `needs-input` while a permission or ask prompt waits for an answer. */
  getLocalActivityStatus(): 'working' | 'needs-input' | 'idle' | undefined;
  listSelfPacedLoops?(): readonly ISessionLoopState[];
};

/** A session the pool holds for one client until the client moves onto it or lets it go. */
export interface IServeSessionLease<TSession> {
  readonly session: TSession;
  cancel(): void;
}

/** One client's place in the pool, as the directory uses it. */
export interface IServeSessionPoolBinding<TSession, TSlot extends { readonly current: TSession }> {
  /** The client's session, following this binding's moves only. */
  readonly slot: TSlot;
  moveTo(lease: IServeSessionLease<TSession>): void;
  /** This binding drives, and no other driver is on its session. */
  isLastDriver(): boolean;
  release(): void;
}

/** The pool the directory binds clients to; `SessionPool` from the framework is one. */
export interface IServeSessionPool<TSession, TSlot extends { readonly current: TSession }> {
  bind(role: TSessionBindingRole): IServeSessionPoolBinding<TSession, TSlot>;
  acquire(sessionId?: string): Promise<IServeSessionLease<TSession>>;
  /** `session` is the live instance itself — the directory reads it to tell "busy" from "idle". */
  listLive(): readonly { readonly sessionId: string; readonly clients: number; readonly session: TSession }[];
}

/** What the served runtime lends the directory once its host has started. */
export interface IServeSessionDirectoryHost<
  TSession extends TServeDirectorySession,
  TSlot extends { readonly current: TSession } = { readonly current: TSession },
> {
  readonly pool: IServeSessionPool<TSession, TSlot>;
  /** The session the runtime started with; a caller that has no binding is on it. */
  readonly primary: TSession;
  readonly store: IInteractiveSessionStore;
  readonly cwd: string;
  /** The runtime is shutting down, so no client changes its session any more. */
  isStopping?(): boolean;
}

/**
 * Binds each client connection to the served runtime's sessions. Its own `listSessions` is for a
 * caller that has no binding and reports the primary session as current.
 */
export interface IServeSessionDirectory<
  TSession extends TServeDirectorySession,
  TSlot extends { readonly current: TSession } = { readonly current: TSession },
> extends ISessionBinder<TSlot> {
  attach(host: IServeSessionDirectoryHost<TSession, TSlot>): void;
  listSessions(): ISessionListing;
}

const STOPPING_MESSAGE = 'This runtime is stopping.';

export function createServeSessionDirectory<
  TSession extends TServeDirectorySession,
  TSlot extends { readonly current: TSession } = { readonly current: TSession },
>(): IServeSessionDirectory<TSession, TSlot> {
  let host: IServeSessionDirectoryHost<TSession, TSlot> | undefined;

  const attached = (): IServeSessionDirectoryHost<TSession, TSlot> => {
    if (host === undefined) throw new Error('Sessions are not available yet.');
    return host;
  };

  const listFor = (
    target: IServeSessionDirectoryHost<TSession, TSlot>,
    current: TSession,
  ): ISessionListing => {
    const live = new Map(target.pool.listLive().map((row) => [row.sessionId, row.clients]));
    const sessions: ISessionListingEntry[] = listResumableSessionSummaries(
      target.store,
      target.cwd,
    ).map((summary) => {
      const clients = live.get(summary.id);
      return { ...summary, live: clients !== undefined, clients: clients ?? 0 };
    });
    return {
      currentSessionId: current.getSession().getSessionId(),
      sessions,
      // #3289 §1: only unreadable records this workspace can claim as its own — a store shared
      // across workspaces (the user-level store) holds legacy records from every folder ever worked
      // in there, and a brand-new folder must not be told about all of them.
      unreadableSessionIds: listUnreadableSessionsForWorkspace(target.store, target.cwd).map(
        (entry) => entry.id,
      ),
    };
  };

  /** This binding's own session id, or `undefined` while it has not named itself yet. */
  const currentSessionIdOf = (binding: IServeSessionPoolBinding<TSession, TSlot>): string | undefined => {
    try {
      return binding.slot.current.getSession().getSessionId();
    } catch {
      return undefined;
    }
  };

  /** How many clients BESIDES this binding are on a session, from the pool's live rows. */
  const otherClientsOn = (
    target: IServeSessionDirectoryHost<TSession, TSlot>,
    binding: IServeSessionPoolBinding<TSession, TSlot>,
  ): ((sessionId: string) => number) => {
    const live = new Map(target.pool.listLive().map((row) => [row.sessionId, row.clients]));
    const currentId = currentSessionIdOf(binding);
    return (sessionId) => {
      const clients = live.get(sessionId);
      if (clients === undefined) return 0;
      return clients - (sessionId === currentId ? 1 : 0);
    };
  };

  /**
   * Whether a session id, if it is currently live, has work of its own in progress — never true for
   * a non-live id, since nothing is running for a session that is not even loaded. A background task
   * or a self-paced loop outlives the client that started it, so a session can be busy with zero
   * clients on it; "New session" reusing that row would land someone in the middle of that work.
   */
  const isLiveSessionBusy = (
    target: IServeSessionDirectoryHost<TSession, TSlot>,
  ): ((sessionId: string) => boolean) => {
    const live = new Map(target.pool.listLive().map((row) => [row.sessionId, row.session]));
    return (sessionId) => {
      const session = live.get(sessionId);
      return session !== undefined && isSessionBusy(session);
    };
  };

  const bindTo = (
    target: IServeSessionDirectoryHost<TSession, TSlot>,
    role: TSessionBindingRole,
  ): ISessionBinding<TSlot> => {
    const binding = target.pool.bind(role);
    let changing = false;

    /** Why this client cannot leave its session now, if it cannot. */
    const refusalToLeave = (): SessionChangeRefusal | undefined => {
      if (target.isStopping?.() === true) {
        return new SessionChangeRefusal('stopping', STOPPING_MESSAGE);
      }
      // A running turn, queued messages or background work go on in the pool without this client.
      // A prompt does not: with no driver left on the session, nobody could answer it.
      if (
        binding.isLastDriver() &&
        binding.slot.current.getLocalActivityStatus() === 'needs-input'
      ) {
        return new SessionChangeRefusal(
          'prompt_pending',
          'Answer or dismiss the pending prompt first: no other client driving this session could answer it.',
        );
      }
      return undefined;
    };

    const changeTo = async (resumeSessionId: string | undefined): Promise<void> => {
      if (target.isStopping?.() === true) {
        throw new SessionChangeRefusal('stopping', STOPPING_MESSAGE);
      }
      if (changing) {
        throw new SessionChangeRefusal('in_progress', 'Another session change is already under way.');
      }
      const refusal = refusalToLeave();
      if (refusal !== undefined) throw refusal;
      changing = true;
      try {
        // Initialized means saved: a new session is listed from here on.
        const lease = await target.pool.acquire(resumeSessionId);
        // Starting the next session takes time, and this client still reaches its session meanwhile:
        // a prompt that opened since the first check is one only it may be left to answer.
        const lateRefusal = refusalToLeave();
        if (lateRefusal !== undefined) {
          lease.cancel();
          throw lateRefusal;
        }
        binding.moveTo(lease);
      } finally {
        changing = false;
      }
    };

    const directory: ISessionDirectory = {
      listSessions: () => listFor(target, binding.slot.current),
      async switchSession(sessionId) {
        if (sessionId === binding.slot.current.getSession().getSessionId()) return;
        if (listUnreadableSessionsForWorkspace(target.store, target.cwd).some((entry) => entry.id === sessionId)) {
          throw new SessionChangeRefusal(
            'unreadable',
            `Session ${sessionId} was saved in a form this version cannot read.`,
          );
        }
        const known = listResumableSessionSummaries(target.store, target.cwd).some(
          (summary) => summary.id === sessionId,
        );
        if (!known) {
          throw new SessionChangeRefusal(
            'unknown_session',
            `No session ${sessionId} in this workspace.`,
          );
        }
        await changeTo(sessionId);
      },
      async newSession() {
        // #3289 §1: reuse an existing empty session of this workspace that no other client is on and
        // has no work of its own in progress, rather than adding another one to the list every time
        // this is pressed, or joining someone into a background task/loop still running on it.
        const reusable = resolveReusableEmptySessionId(target.store, target.cwd, {
          otherClientsOf: otherClientsOn(target, binding),
          isBusy: isLiveSessionBusy(target),
        });
        await changeTo(reusable);
      },
      async renameSession(sessionId, name) {
        const known = listResumableSessionSummaries(target.store, target.cwd).some(
          (summary) => summary.id === sessionId,
        );
        if (!known) {
          throw new Error(`No session ${sessionId} in this workspace.`);
        }
        // A live session keeps its own name in memory and writes it back on every persist (a turn,
        // a background task, a goal step, …), which would silently undo a rename made only on disk —
        // this path is for a row that is not live. The CURRENT session's own rename path (the
        // `/rename` command) goes through the live session instead, so its in-memory name and
        // broadcast stay correct; a session live for some OTHER client has no such path available to
        // this binding, so it is refused rather than risked.
        if (target.pool.listLive().some((row) => row.sessionId === sessionId)) {
          throw new Error(
            `Session ${sessionId} is open now; renaming it here would be overwritten the next ` +
              'time it saves. Switch to it to rename it, or wait for it to close.',
          );
        }
        persistSessionRename(target.store, sessionId, name);
      },
      async deleteSession(sessionId) {
        if (target.isStopping?.() === true) {
          throw new SessionDeleteRefusal('stopping', STOPPING_MESSAGE);
        }
        const known = listResumableSessionSummaries(target.store, target.cwd).some(
          (summary) => summary.id === sessionId,
        );
        if (!known) {
          throw new SessionDeleteRefusal(
            'unknown_session',
            `No session ${sessionId} in this workspace.`,
          );
        }
        const isCurrent = sessionId === currentSessionIdOf(binding);
        const liveEntry = target.pool.listLive().find((row) => row.sessionId === sessionId);
        if (liveEntry !== undefined) {
          const others = liveEntry.clients - (isCurrent ? 1 : 0);
          if (others > 0) {
            throw new SessionDeleteRefusal(
              'live_elsewhere',
              'Another client is on this session; it cannot be deleted while someone else is using it.',
            );
          }
          // The same completeness `SessionPool` itself uses to decide whether a session may be
          // closed: a running turn, a pending prompt, a live background task, or an unexpired
          // self-paced loop — not only "mid-turn", which missed the other three.
          if (isSessionBusy(liveEntry.session)) {
            throw new SessionDeleteRefusal(
              'running',
              'This session has work in progress; wait for it to finish, then delete it.',
            );
          }
        }
        if (isCurrent) {
          // Switch this binding away before the record it is on disappears: to another session of
          // this workspace when one exists, newest first, or a fresh one when this was the only one.
          const nextExisting = listResumableSessionSummaries(target.store, target.cwd).find(
            (summary) => summary.id !== sessionId,
          )?.id;
          await changeTo(nextExisting);
        }
        target.store.delete(sessionId);
      },
    };

    return { session: binding.slot, directory, release: () => binding.release() };
  };

  return {
    attach(next) {
      host = next;
    },
    bind(role) {
      return bindTo(attached(), role);
    },
    listSessions(): ISessionListing {
      const target = attached();
      return listFor(target, target.primary);
    },
  };
}
