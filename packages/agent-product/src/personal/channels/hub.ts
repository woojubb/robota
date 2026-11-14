/**
 * The channel hub: every adapter plugs in here, and the hub keeps the rules no adapter can change.
 *
 * Only the owner speaks to the agent through a channel: each channel is bound to the sender ids the
 * owner verified on it, and a message from anyone else gets no turn and no reply. A turn runs through
 * a port the host supplies, so the hub never chooses a session or a model. Approvals go out as
 * structured actions where the platform has them, and as a plain notice pointing to the feed where it
 * does not; an answer counts only as a structured action from the owner.
 */
import type {
  IChannelAdapter,
  IChannelApprovalAnswer,
  IChannelApprovalRequest,
  IChannelMessage,
} from './types.js';

/** Runs one turn for a channel conversation and returns the agent's reply. */
export type TChannelTurn = (
  key: { readonly channel: string; readonly conversationId: string },
  text: string,
) => Promise<string>;

/** Answers an approval waiting in the feed. */
export type TChannelApprovalAnswer = (approvalId: string, approve: boolean) => Promise<void>;

export interface IChannelBinding {
  readonly adapter: IChannelAdapter;
  /** The owner's sender ids on this platform, verified when the channel was connected. */
  readonly ownerSenderIds: readonly string[];
  /** Where approvals and notices go on this platform. */
  readonly notifyConversationId?: string;
}

export interface IChannelHubOptions {
  readonly runTurn: TChannelTurn;
  readonly answerApproval: TChannelApprovalAnswer;
  /** Called when a message from someone other than the owner is dropped; for the host's log. */
  readonly onRefused?: (channel: string, senderId: string) => void;
}

export interface IChannelHub {
  connect(binding: IChannelBinding): Promise<void>;
  disconnect(channelId: string): Promise<void>;
  /** Tell the owner on every connected channel that an approval waits, with actions where possible. */
  announceApproval(request: Omit<IChannelApprovalRequest, 'conversationId'>): Promise<void>;
  /** Tell the owner something on every connected channel. */
  notify(text: string): Promise<void>;
  channels(): readonly {
    readonly id: string;
    readonly capabilities: IChannelAdapter['capabilities'];
  }[];
}

/** Split text so each part fits the platform's limit, at line or word boundaries where possible. */
export function splitForChannel(text: string, limit: number | undefined): string[] {
  if (limit === undefined || text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
    const at = cut > limit / 2 ? cut : limit;
    parts.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest !== '') parts.push(rest);
  return parts;
}

export function createChannelHub(options: IChannelHubOptions): IChannelHub {
  const bindings = new Map<string, IChannelBinding>();

  const isOwner = (binding: IChannelBinding, senderId: string): boolean =>
    binding.ownerSenderIds.includes(senderId);

  const send = async (
    binding: IChannelBinding,
    conversationId: string,
    text: string,
  ): Promise<void> => {
    for (const part of splitForChannel(text, binding.adapter.capabilities.maxTextLength)) {
      await binding.adapter.send(conversationId, part);
    }
  };

  const handlerFor = (binding: IChannelBinding) => ({
    async onMessage(message: IChannelMessage): Promise<void> {
      if (!isOwner(binding, message.senderId)) {
        options.onRefused?.(binding.adapter.id, message.senderId);
        return;
      }
      const reply = await options.runTurn(
        { channel: binding.adapter.id, conversationId: message.conversationId },
        message.text,
      );
      await send(binding, message.conversationId, reply);
    },
    async onApprovalAnswer(answer: IChannelApprovalAnswer): Promise<void> {
      // Only a structured action from the owner answers an approval; anyone else's is ignored.
      if (!isOwner(binding, answer.senderId)) {
        options.onRefused?.(binding.adapter.id, answer.senderId);
        return;
      }
      await options.answerApproval(answer.approvalId, answer.approve);
    },
  });

  return {
    async connect(binding) {
      if (bindings.has(binding.adapter.id))
        throw new Error(`Channel ${binding.adapter.id} is already connected`);
      if (binding.ownerSenderIds.length === 0)
        throw new Error('A channel needs the owner identity it admits');
      if (binding.adapter.capabilities.actions && binding.adapter.requestApproval === undefined) {
        throw new Error(
          `Channel ${binding.adapter.id} declares actions but cannot request an approval`,
        );
      }
      await binding.adapter.start(handlerFor(binding));
      bindings.set(binding.adapter.id, binding);
    },
    async disconnect(channelId) {
      const binding = bindings.get(channelId);
      if (binding === undefined) return;
      bindings.delete(channelId);
      await binding.adapter.stop();
    },
    async announceApproval(request) {
      for (const binding of bindings.values()) {
        if (binding.notifyConversationId === undefined) continue;
        const conversationId = binding.notifyConversationId;
        if (binding.adapter.capabilities.actions && binding.adapter.requestApproval !== undefined) {
          await binding.adapter.requestApproval({ ...request, conversationId });
        } else {
          // Without actions there is no safe way to answer here: free text is never an approval.
          await send(
            binding,
            conversationId,
            `${request.title} is waiting for your approval: ${request.detail}. Approve or decline it in your Feed.`,
          );
        }
      }
    },
    async notify(text) {
      for (const binding of bindings.values()) {
        if (binding.notifyConversationId !== undefined)
          await send(binding, binding.notifyConversationId, text);
      }
    },
    channels() {
      return [...bindings.values()].map((binding) => ({
        id: binding.adapter.id,
        capabilities: binding.adapter.capabilities,
      }));
    },
  };
}
