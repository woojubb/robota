/**
 * #3189 — the sessions a served runtime keeps, one view of them per client.
 *
 * `robota --serve` keeps several sessions live in a pool. Each client connection binds to it and
 * gets a view of its own: its directory lists the workspace's stored sessions, says which one THIS
 * client is on and which are live, and a switch or a new session moves this client alone. Leaving a
 * session that is working does not stop that work: the pool keeps the session running. A change is
 * refused only where carrying it out would leave something no one can finish — a prompt that only
 * this client could answer — and a refusal says why with a code the client can branch on.
 */

import {
  SessionChangeRefusal,
  listResumableSessionSummaries,
  listUnreadableSessions,
} from '@robota-sdk/agent-framework';

import type {
  IInteractiveSession,
  IInteractiveSessionStore,
  ISessionBinder,
  ISessionBinding,
  ISessionDirectory,
  ISessionListing,
  ISessionListingEntry,
  TSessionBindingRole,
} from '@robota-sdk/agent-interface-session';

/** The members of a session the directory reads: its id, and whether a prompt waits on it. */
export type TServeDirectorySession = Pick<IInteractiveSession, 'getSession'> & {
  /** `needs-input` while a permission or ask prompt waits for an answer. */
  getLocalActivityStatus(): 'working' | 'needs-input' | 'idle' | undefined;
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
  listLive(): readonly { readonly sessionId: string; readonly clients: number }[];
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
      unreadableSessionIds: listUnreadableSessions(target.store).map((entry) => entry.id),
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
        if (listUnreadableSessions(target.store).some((entry) => entry.id === sessionId)) {
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
        await changeTo(undefined);
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
