/**
 * An in-memory channel: what a messenger adapter does, without a messenger. Tests and contract checks
 * drive it as a platform would, and read what the agent sent back.
 */
import type {
  IChannelAdapter,
  IChannelApprovalRequest,
  IChannelCapabilities,
  IChannelHandler,
} from './types.js';

export interface IFixtureChannel extends IChannelAdapter {
  /** Deliver a message as the platform would. */
  deliver(conversationId: string, senderId: string, text: string): Promise<void>;
  /** Press an approval's action as the platform would. */
  press(approvalId: string, approve: boolean, senderId: string): Promise<void>;
  readonly sent: readonly { readonly conversationId: string; readonly text: string }[];
  readonly approvalRequests: readonly IChannelApprovalRequest[];
}

export function createFixtureChannel(
  options: { readonly id?: string; readonly capabilities?: Partial<IChannelCapabilities> } = {},
): IFixtureChannel {
  const capabilities: IChannelCapabilities = {
    actions: true,
    attachments: false,
    voice: false,
    ...options.capabilities,
  };
  const sent: { conversationId: string; text: string }[] = [];
  const approvalRequests: IChannelApprovalRequest[] = [];
  let handler: IChannelHandler | undefined;
  const running = (): IChannelHandler => {
    if (handler === undefined) throw new Error('The channel is not started');
    return handler;
  };
  const channel: IFixtureChannel = {
    id: options.id ?? 'fixture',
    capabilities,
    sent,
    approvalRequests,
    start: async (next) => {
      handler = next;
    },
    stop: async () => {
      handler = undefined;
    },
    send: async (conversationId, text) => {
      sent.push({ conversationId, text });
    },
    deliver: (conversationId, senderId, text) =>
      running().onMessage({ conversationId, senderId, text }),
    press: (approvalId, approve, senderId) =>
      running().onApprovalAnswer({ approvalId, approve, senderId }),
  };
  if (capabilities.actions) {
    return {
      ...channel,
      requestApproval: async (request) => {
        approvalRequests.push(request);
      },
    };
  }
  return channel;
}
