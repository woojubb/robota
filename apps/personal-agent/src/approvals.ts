/**
 * The approvals waiting for the person, whatever raised them: a goal run in the background or a
 * message from a channel. Each waits on one session's prompt and shows in the feed; the person's
 * answer, from the page or as a channel's structured action, resolves exactly that prompt.
 */
import type { GoalBook, IFeedItem } from '@robota-sdk/agent-product/personal';
import type { IApprovalCancellations, IApprovalIdentity } from './approval-cancellations.js';
import type { TPersonalSession } from './agent.js';

export interface IPendingApproval {
  readonly session: Pick<TPersonalSession, 'resolvePermission'>;
  readonly promptId: string;
  /** The goal waiting on it, when a goal raised it. */
  readonly goalId?: string;
  /**
   * Record the person's answer before the session hears it.
   */
  readonly recordAnswer: (approve: boolean) => Promise<IFeedItem>;
}

export interface IApprovalRegistry {
  /** Prevent an approval being mistaken for an orphan while it is being posted. */
  preparing(): () => void;
  register(item: IFeedItem, entry: IPendingApproval): void;
  /** Remove an approval nobody can answer any more; true when it was still waiting. */
  release(feedId: string): boolean;
  waitingFor(goalId: string): boolean;
  answer(feedId: string, approve: boolean): Promise<IFeedItem>;
  /** Retry expiration of approvals whose answer could not be recorded. */
  settleFailed(): Promise<void>;
  /** Reconcile durable cancellations before recovering abandoned work. */
  restore(): Promise<void>;
  /** Cancel and drain answers owned by a session that is stopping. */
  cancelSession(session: IPendingApproval['session']): Promise<void>;
  /** Prevent new answers and drain all in-flight approval records. */
  shutdown(): Promise<void>;
  /** Called with each new approval, such as to tell the person on their channels. */
  onRegistered(listener: (item: IFeedItem) => void): void;
}

export function createApprovalRegistry(
  book: GoalBook,
  otherAgents: () => boolean = () => false,
  recoverOrphan?: (item: IFeedItem) => Promise<void>,
  cancellations?: IApprovalCancellations,
): IApprovalRegistry {
  type TExpected = IApprovalIdentity;
  const pending = new Map<
    string,
    { readonly entry: IPendingApproval; readonly expected: TExpected }
  >();
  const answering = new Map<
    string,
    {
      readonly entry: IPendingApproval;
      readonly expected: TExpected;
      cancelled: boolean;
      readonly done: Promise<void>;
    }
  >();
  const stoppingSessions = new WeakSet<object>();
  let closing = false;
  const failed = new Map<string, TExpected>();
  const attempts = new Map<string, Promise<void>>();
  const matches = (item: IFeedItem, expected: TExpected): boolean =>
    item.id === expected.id &&
    item.goalId === expected.goalId &&
    item.runId === expected.runId &&
    item.approval?.tool === expected.tool &&
    item.approval.detail === expected.detail;
  const expireFailed = (expected: TExpected): void => {
    failed.set(expected.id, expected);
    try {
      cancellations?.mark(expected);
    } catch {
      // A failed intent is retried before shutdown or any later work.
    }
    if (attempts.has(expected.id)) return;
    const attempt = (async () => {
      cancellations?.mark(expected);
      await book.cancelApproval(expected.id, expected);
      await cancellations?.finish(expected);
      failed.delete(expected.id);
    })()
      .catch(() => undefined)
      .finally(() => attempts.delete(expected.id));
    attempts.set(expected.id, attempt);
  };
  let posting = 0;
  const listeners: ((item: IFeedItem) => void)[] = [];
  return {
    preparing() {
      posting += 1;
      let complete = false;
      return () => {
        if (complete) return;
        complete = true;
        posting -= 1;
      };
    },
    register(item, entry) {
      if (closing || stoppingSessions.has(entry.session)) throw new Error('The agent is stopping');
      if (item.approval?.state !== 'pending') throw new Error('The approval is not pending');
      pending.set(item.id, {
        entry,
        expected: {
          id: item.id,
          goalId: item.goalId,
          runId: item.runId,
          tool: item.approval.tool,
          detail: item.approval.detail,
        },
      });
      for (const listener of listeners) {
        try {
          listener(item);
        } catch {
          // allow-fallback: telling the person elsewhere must never keep the approval from waiting.
        }
      }
    },
    release: (feedId) => {
      const found = pending.get(feedId);
      if (found !== undefined) {
        pending.delete(feedId);
        expireFailed(found.expected);
        return true;
      }
      const flight = answering.get(feedId);
      if (flight !== undefined) {
        flight.cancelled = true;
        expireFailed(flight.expected);
      }
      return false;
    },
    waitingFor: (goalId) => [...pending.values()].some(({ entry }) => entry.goalId === goalId),
    async answer(feedId, approve) {
      if (closing) throw new Error('The agent is stopping');
      const found = pending.get(feedId);
      if (found === undefined) {
        if (answering.has(feedId)) throw new Error('This approval is being answered; try again');
        const item = await book.feedItem(feedId);
        if (item?.approval?.state === 'pending') {
          if (posting > 0) throw new Error('This approval is still being prepared; try again');
          if (otherAgents())
            throw new Error('This approval is waiting in another agent; answer it there');
          await recoverOrphan?.(item);
          const current = await book.feedItem(feedId);
          return current?.approval?.state === 'pending'
            ? book.setApproval(feedId, 'expired')
            : (current ?? item);
        }
        throw new Error('This approval is no longer waiting');
      }
      const { entry: waiting, expected } = found;
      pending.delete(feedId);
      if (stoppingSessions.has(waiting.session)) {
        waiting.session.resolvePermission(waiting.promptId, false);
        expireFailed(expected);
        throw new Error('The approval is no longer waiting');
      }
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const flight = { entry: waiting, expected, cancelled: false, done };
      answering.set(feedId, flight);
      let handedOff = false;
      try {
        // Recovery can distinguish an answer still being recorded from an authorized handoff.
        cancellations?.mark(expected);
        const recorded = await waiting.recordAnswer(approve);
        if (flight.cancelled || closing) throw new Error('The approval was cancelled');
        if (
          !matches(recorded, expected) ||
          recorded.approval?.state !== (approve ? 'approved' : 'denied')
        )
          throw new Error('The recorded approval differs from the displayed action');
        await cancellations?.authorize(expected, () => !flight.cancelled && !closing);
        if (flight.cancelled || closing) throw new Error('The approval was cancelled');
        answering.delete(feedId);
        handedOff = true;
        waiting.session.resolvePermission(waiting.promptId, approve);
        try {
          await cancellations?.finish(expected);
        } catch {
          // An authorized intent preserves the answer for reconciliation on restart.
        }
        return recorded;
      } catch (error) {
        if (!handedOff) {
          waiting.session.resolvePermission(waiting.promptId, false);
          expireFailed(expected);
        }
        throw error;
      } finally {
        answering.delete(feedId);
        finish();
      }
    },
    async settleFailed() {
      for (const expected of failed.values()) expireFailed(expected);
      await Promise.all([...attempts.values()]);
      // If feed repair is unavailable, a durable intent must survive shutdown.
      for (const expected of failed.values()) cancellations?.mark(expected);
    },
    async restore() {
      for (const expected of cancellations?.list() ?? []) {
        if (answering.has(expected.id)) continue;
        if (expected.phase === 'authorized') await cancellations?.finish(expected);
        else failed.set(expected.id, expected);
      }
      await this.settleFailed();
      if (failed.size > 0) throw new Error('Approval cancellations could not be recovered');
    },
    async cancelSession(session) {
      stoppingSessions.add(session);
      for (const [id, found] of pending) {
        if (found.entry.session !== session) continue;
        pending.delete(id);
        found.entry.session.resolvePermission(found.entry.promptId, false);
        expireFailed(found.expected);
      }
      const active = [...answering.values()].filter((flight) => flight.entry.session === session);
      for (const flight of active) {
        flight.cancelled = true;
        expireFailed(flight.expected);
      }
      await Promise.all(active.map((flight) => flight.done));
    },
    async shutdown() {
      closing = true;
      for (const [id, found] of pending) {
        pending.delete(id);
        found.entry.session.resolvePermission(found.entry.promptId, false);
        expireFailed(found.expected);
      }
      const active = [...answering.values()];
      for (const flight of active) {
        flight.cancelled = true;
        expireFailed(flight.expected);
      }
      await Promise.all(active.map((flight) => flight.done));
      await this.settleFailed();
    },
    onRegistered(listener) {
      listeners.push(listener);
    },
  };
}
