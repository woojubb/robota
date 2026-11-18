/**
 * The approvals waiting for the person, whatever raised them: a goal run in the background or a
 * message from a channel. Each waits on one session's prompt and shows in the feed; the person's
 * answer, from the page or as a channel's structured action, resolves exactly that prompt.
 */
import type { GoalBook, IFeedItem } from '@robota-sdk/agent-product/personal';
import type { TPersonalSession } from './agent.js';

export interface IPendingApproval {
  readonly session: Pick<TPersonalSession, 'resolvePermission'>;
  readonly promptId: string;
  /** The goal waiting on it, when a goal raised it. */
  readonly goalId?: string;
  /**
   * Record the person's answer. Queued before the session hears the answer, so whatever waits on the
   * prompt cannot finish ahead of the record of what allowed it to go on.
   */
  readonly recordAnswer: (approve: boolean) => Promise<IFeedItem>;
}

export interface IApprovalRegistry {
  register(item: IFeedItem, entry: IPendingApproval): void;
  /** Remove an approval nobody can answer any more; true when it was still waiting. */
  release(feedId: string): boolean;
  waitingFor(goalId: string): boolean;
  answer(feedId: string, approve: boolean): Promise<IFeedItem>;
  /** Called with each new approval, such as to tell the person on their channels. */
  onRegistered(listener: (item: IFeedItem) => void): void;
}

export function createApprovalRegistry(
  book: GoalBook,
  otherAgents: () => boolean = () => false,
  recoverOrphan?: (item: IFeedItem) => Promise<void>,
): IApprovalRegistry {
  const pending = new Map<string, IPendingApproval>();
  const listeners: ((item: IFeedItem) => void)[] = [];
  return {
    register(item, entry) {
      pending.set(item.id, entry);
      for (const listener of listeners) {
        try {
          listener(item);
        } catch {
          // allow-fallback: telling the person elsewhere must never keep the approval from waiting.
        }
      }
    },
    release: (feedId) => pending.delete(feedId),
    waitingFor: (goalId) => [...pending.values()].some((entry) => entry.goalId === goalId),
    async answer(feedId, approve) {
      const waiting = pending.get(feedId);
      if (waiting === undefined) {
        const item = await book.feedItem(feedId);
        if (item?.approval?.state === 'pending') {
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
      pending.delete(feedId);
      // The record is queued first and the session answered at once: nothing can settle the prompt
      // between the person's answer and the session receiving it.
      const recorded = waiting.recordAnswer(approve);
      waiting.session.resolvePermission(waiting.promptId, approve);
      return recorded;
    },
    onRegistered(listener) {
      listeners.push(listener);
    },
  };
}
