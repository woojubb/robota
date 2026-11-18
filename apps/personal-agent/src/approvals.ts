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
  /** Called with each new approval, such as to tell the person on their channels. */
  onRegistered(listener: (item: IFeedItem) => void): void;
}

export function createApprovalRegistry(
  book: GoalBook,
  otherAgents: () => boolean = () => false,
  recoverOrphan?: (item: IFeedItem) => Promise<void>,
): IApprovalRegistry {
  const pending = new Map<
    string,
    {
      readonly entry: IPendingApproval;
      readonly expected: {
        readonly id: string;
        readonly goalId: string | undefined;
        readonly runId: string | undefined;
        readonly tool: string;
        readonly detail: string;
      };
    }
  >();
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
    release: (feedId) => pending.delete(feedId),
    waitingFor: (goalId) => [...pending.values()].some(({ entry }) => entry.goalId === goalId),
    async answer(feedId, approve) {
      const found = pending.get(feedId);
      if (found === undefined) {
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
      try {
        const recorded = await waiting.recordAnswer(approve);
        if (
          recorded.id !== expected.id ||
          recorded.goalId !== expected.goalId ||
          recorded.runId !== expected.runId ||
          recorded.approval?.tool !== expected.tool ||
          recorded.approval.detail !== expected.detail ||
          recorded.approval.state !== (approve ? 'approved' : 'denied')
        )
          throw new Error('The recorded approval differs from the displayed action');
        waiting.session.resolvePermission(waiting.promptId, approve);
        return recorded;
      } catch (error) {
        waiting.session.resolvePermission(waiting.promptId, false);
        throw error;
      }
    },
    onRegistered(listener) {
      listeners.push(listener);
    },
  };
}
