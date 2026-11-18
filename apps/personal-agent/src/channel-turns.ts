/**
 * Conversations that arrive through a channel. Each channel conversation is one chat of its own,
 * kept among the person's chats, with the agent's tools and limits. Whatever such a chat would ask
 * the person becomes an approval in the feed, announced on their channels, and the turn waits for it.
 */
import { describeCall } from './goal-runner.js';

import type { GoalBook } from '@robota-sdk/agent-product/personal';
import type { IExtraSessionOptions, TPersonalSession } from './agent.js';
import type { IApprovalRegistry } from './approvals.js';

type TChannelSession = Pick<
  TPersonalSession,
  'on' | 'off' | 'submit' | 'resolvePermission' | 'shutdown' | 'abort'
>;

export interface IChannelTurnsOptions {
  readonly book: GoalBook;
  readonly approvals: IApprovalRegistry;
  readonly openSession: (extra: IExtraSessionOptions) => TChannelSession;
}

export interface IChannelTurns {
  runTurn(
    key: { readonly channel: string; readonly conversationId: string },
    text: string,
  ): Promise<string>;
  /** End the turns in progress, as a person's Stop does; the conversations stay open. */
  interrupt(): void;
  stop(): Promise<void>;
}

export function createChannelTurns(options: IChannelTurnsOptions): IChannelTurns {
  const { book, approvals } = options;
  const sessions = new Map<string, TChannelSession>();
  const notices = new Set<Promise<void>>();
  /** Turns run one at a time per conversation, in the order their messages arrived. */
  const queues = new Map<string, Promise<unknown>>();

  const sessionFor = (channel: string, conversationId: string): TChannelSession => {
    const key = `${channel}\u0000${conversationId}`;
    let session = sessions.get(key);
    if (session !== undefined) return session;
    const opened = options.openSession({
      sessionName: `${channel} conversation`,
      instructions: `This conversation arrives through ${channel}. Keep replies short enough for a messenger.`,
      permissionMode: 'acceptEdits',
      keepWith: 'chats',
    });
    const ownPrompts = new Map<string, string>();
    /** Prompts settled before their approval was posted, such as by a shutdown: never offered. */
    const settledEarly = new Set<string>();
    opened.on('permission_request', ((event: {
      id: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
    }) => {
      void (async () => {
        const detail = describeCall(event.toolName, event.toolArgs);
        if (detail === undefined) {
          opened.resolvePermission(event.id, false);
          settledEarly.delete(event.id);
          // A failed notice does not undo the refusal. A pending write must settle before shutdown.
          const notice = book
            .post({
              kind: 'notice',
              title: `A message on ${channel}`,
              body: 'The connector action was refused because its complete details are too long or cannot be shown safely.',
            })
            .then(
              () => undefined,
              () => undefined,
            );
          notices.add(notice);
          void notice.then(() => notices.delete(notice));
          return;
        }
        const item = await book.post({
          kind: 'approval',
          title: `A message on ${channel}`,
          body: `Your agent wants to use ${event.toolName} to answer you on ${channel}.`,
          approval: { tool: event.toolName, detail, state: 'pending' },
        });
        ownPrompts.set(event.id, item.id);
        if (settledEarly.delete(event.id)) {
          await book.setApproval(item.id, 'expired');
          return;
        }
        approvals.register(item, {
          session: opened,
          promptId: event.id,
          recordAnswer: (approve) => book.setApproval(item.id, approve ? 'approved' : 'denied'),
        });
      })().catch(() => undefined);
    }) as never);
    // A prompt settled by anything but the person's answer can no longer be approved.
    opened.on('prompt_resolved', ((event: { id: string }) => {
      const feedId = ownPrompts.get(event.id);
      if (feedId === undefined) {
        settledEarly.add(event.id);
        return;
      }
      if (approvals.release(feedId))
        void book.setApproval(feedId, 'expired').catch(() => undefined);
    }) as never);
    sessions.set(key, opened);
    return opened;
  };

  return {
    runTurn(key, text) {
      const session = sessionFor(key.channel, key.conversationId);
      const queueKey = `${key.channel}\u0000${key.conversationId}`;
      const turn = (queues.get(queueKey) ?? Promise.resolve()).then(async () => {
        const handle = await session.submit(text);
        const result = await handle.completed;
        return result.response.trim() === '' ? '(no reply)' : result.response.trim();
      });
      queues.set(
        queueKey,
        turn.catch(() => undefined),
      );
      return turn;
    },
    interrupt() {
      for (const session of sessions.values()) session.abort();
    },
    async stop() {
      for (const session of sessions.values()) session.abort();
      await Promise.allSettled([...sessions.values()].map((session) => session.shutdown()));
      await Promise.allSettled([...notices]);
      sessions.clear();
    },
  };
}
