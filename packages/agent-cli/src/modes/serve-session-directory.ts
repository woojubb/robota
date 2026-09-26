/**
 * #3189 — the sessions a served runtime can switch between.
 *
 * `robota --serve` holds one current session in its host's slot. This directory lists the
 * workspace's stored sessions and makes another one current — or a fresh one — without the process
 * or any client connection restarting. A change that would lose work in progress is refused with the
 * reason, never carried out halfway.
 */

import { isTerminalBackgroundTaskStatus } from '@robota-sdk/agent-executor';
import { listResumableSessionSummaries, listUnreadableSessions } from '@robota-sdk/agent-framework';

import type {
  IInteractiveSession,
  IInteractiveSessionStore,
  ISessionDirectory,
  ISessionListing,
} from '@robota-sdk/agent-interface-session';

/** The members of a session the directory reads to decide whether leaving it would lose work. */
export type TServeDirectorySession = Pick<
  IInteractiveSession,
  | 'isExecuting'
  | 'getPendingPrompt'
  | 'getPendingCount'
  | 'listBackgroundTasks'
  | 'getSession'
  | 'shutdown'
> & {
  /** `needs-input` while a permission or ask prompt waits for an answer. */
  getLocalActivityStatus(): 'working' | 'needs-input' | 'idle' | undefined;
  /** Resolves once the session is initialized and saved; rejects if it could not start. */
  whenInitialized(): Promise<void>;
};

/** What the served runtime lends the directory once its host has started. */
export interface IServeSessionDirectoryHost<TSession extends TServeDirectorySession> {
  readonly slot: { readonly current: TSession; replace(next: TSession): Promise<void> };
  readonly store: IInteractiveSessionStore;
  readonly cwd: string;
  /** Build a session with the runtime's options, resuming `resumeSessionId` when given. */
  buildSession(resumeSessionId: string | undefined): TSession;
  /** Why this runtime cannot change its session at all right now, if it cannot. */
  switchBlockedReason?(): string | undefined;
  /**
   * Hand what belongs to the run — not to a session — over to `next` before it becomes current
   * (external-event grants). A rejection keeps the current session, and the host keeps its state on it.
   */
  adopt?(next: TSession): Promise<void>;
}

/** An {@link ISessionDirectory} whose host is attached after the transports that carry it exist. */
export interface IServeSessionDirectory<
  TSession extends TServeDirectorySession,
> extends ISessionDirectory {
  attach(host: IServeSessionDirectoryHost<TSession>): void;
}

export function createServeSessionDirectory<
  TSession extends TServeDirectorySession,
>(): IServeSessionDirectory<TSession> {
  let host: IServeSessionDirectoryHost<TSession> | undefined;
  let switching = false;

  const attached = (): IServeSessionDirectoryHost<TSession> => {
    if (host === undefined) throw new Error('Sessions are not available yet.');
    return host;
  };

  const refusalToLeave = (
    target: IServeSessionDirectoryHost<TSession>,
    ownChange = false,
  ): string | undefined => {
    const blocked = target.switchBlockedReason?.();
    if (blocked !== undefined) return blocked;
    if (switching && !ownChange) return 'Another session change is already under way.';
    const session = target.slot.current;
    if (session.isExecuting()) return 'Stop the running turn first.';
    if (session.getLocalActivityStatus() === 'needs-input') {
      return 'Answer or dismiss the pending prompt first.';
    }
    if (session.getPendingPrompt() !== null || session.getPendingCount() > 0) {
      return 'Wait for the queued messages to run, or cancel them first.';
    }
    const live = session
      .listBackgroundTasks()
      .filter((task) => !isTerminalBackgroundTaskStatus(task.status)).length;
    if (live > 0) {
      return `${live} background task(s) are still running in this session. Wait for them or cancel them first.`;
    }
    return undefined;
  };

  const changeTo = async (resumeSessionId: string | undefined): Promise<void> => {
    const target = attached();
    const refusal = refusalToLeave(target);
    if (refusal !== undefined) throw new Error(refusal);
    switching = true;
    try {
      const next = target.buildSession(resumeSessionId);
      try {
        // Initialized means saved: a new session is listed from here on.
        await next.whenInitialized();
      } catch (error) {
        // allow-fallback: the session that failed to start is discarded; its failure is the answer.
        await next
          .shutdown({ reason: 'other', message: 'session failed to start' })
          .catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`The session could not be started: ${reason}`);
      }
      // Starting the next session takes time, and clients still reach the current one meanwhile: a
      // turn, a prompt or a task that began since the first check is work a switch now would lose.
      const lateRefusal = refusalToLeave(target, true);
      if (lateRefusal !== undefined) {
        await next
          .shutdown({ reason: 'other', message: 'switch refused' })
          .catch(() => undefined);
        throw new Error(lateRefusal);
      }
      try {
        await target.adopt?.(next);
      } catch (error) {
        // allow-fallback: the run stays with the current session; the next one is discarded.
        await next
          .shutdown({ reason: 'other', message: 'session could not take over the run' })
          .catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`The session could not take over this runtime: ${reason}`);
      }
      await target.slot.replace(next);
    } finally {
      switching = false;
    }
  };

  return {
    attach(next) {
      host = next;
    },
    listSessions(): ISessionListing {
      const target = attached();
      return {
        currentSessionId: target.slot.current.getSession().getSessionId(),
        sessions: listResumableSessionSummaries(target.store, target.cwd),
        unreadableSessionIds: listUnreadableSessions(target.store).map((entry) => entry.id),
      };
    },
    async switchSession(sessionId) {
      const target = attached();
      if (sessionId === target.slot.current.getSession().getSessionId()) return;
      if (listUnreadableSessions(target.store).some((entry) => entry.id === sessionId)) {
        throw new Error(`Session ${sessionId} was saved in a form this version cannot read.`);
      }
      const known = listResumableSessionSummaries(target.store, target.cwd).some(
        (summary) => summary.id === sessionId,
      );
      if (!known) throw new Error(`No session ${sessionId} in this workspace.`);
      await changeTo(sessionId);
    },
    async newSession() {
      await changeTo(undefined);
    },
  };
}
