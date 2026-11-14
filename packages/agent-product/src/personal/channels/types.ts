/**
 * The standard channel contract: how any messenger plugs into a personal agent.
 *
 * An adapter turns one platform into this contract and nothing more. It declares what its platform
 * can do, so the agent degrades by declaration rather than by platform name, and it reports who sent
 * each message as the platform authenticated them. Everything an adapter delivers (the carrier and the
 * payload) is untrusted: the hub, not the adapter, decides whether a sender is the person the agent
 * works for, and an approval is only ever a structured action from that person, never text the model
 * reads.
 */

/** What a platform can carry, declared by its adapter. */
export interface IChannelCapabilities {
  /** Structured actions such as approve and decline buttons, answered as data, not text. */
  readonly actions: boolean;
  readonly attachments: boolean;
  readonly voice: boolean;
  /** The longest text one message may carry, when the platform limits it. */
  readonly maxTextLength?: number;
}

/** A message a platform delivered. */
export interface IChannelMessage {
  /** The conversation on that platform (a chat, a thread, a direct-message channel). */
  readonly conversationId: string;
  /** The sender as the platform authenticated them; the hub checks it against the owner's identity. */
  readonly senderId: string;
  readonly text: string;
}

/** The answer to an approval request, given through a platform's structured action. */
export interface IChannelApprovalAnswer {
  readonly approvalId: string;
  readonly approve: boolean;
  readonly senderId: string;
}

/** What the hub hands an adapter when it starts it. */
export interface IChannelHandler {
  onMessage(message: IChannelMessage): Promise<void>;
  onApprovalAnswer(answer: IChannelApprovalAnswer): Promise<void>;
}

export interface IChannelApprovalRequest {
  readonly conversationId: string;
  readonly approvalId: string;
  readonly title: string;
  /** What will happen if approved: the action and where it goes. */
  readonly detail: string;
}

export interface IChannelAdapter {
  /** A stable name for the platform, such as `fixture` or a messenger's name. */
  readonly id: string;
  readonly capabilities: IChannelCapabilities;
  start(handler: IChannelHandler): Promise<void>;
  stop(): Promise<void>;
  send(conversationId: string, text: string): Promise<void>;
  /** Present when `capabilities.actions` is true: ask with approve and decline actions. */
  requestApproval?(request: IChannelApprovalRequest): Promise<void>;
}
