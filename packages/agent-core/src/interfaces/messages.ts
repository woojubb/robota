/**
 * Message Contracts (Single Source of Truth)
 *
 * IMPORTANT:
 * - This module is owned by the `interfaces` layer.
 * - All message types used across the SDK must be defined here to avoid drift.
 * - Runtime values (variables/classes/objects) and compile-time types can share the same name in TypeScript.
 *   Prefixing type aliases (`T*`) and interfaces (`I*`) reduces value/type name collision risk and review overhead.
 */

/**
 * Universal message role type - provider-independent neutral role.
 */
export type TUniversalMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Message metadata used across conversation history and provider adapters.
 */
export type TUniversalMessageMetadata = Record<
  string,
  string | number | boolean | Date | string[] | number[] | Record<string, number>
>;

/**
 * Universal multimodal message part contracts.
 */
export interface ITextMessagePart {
  type: 'text';
  text: string;
}

export interface IInlineImageMessagePart {
  type: 'image_inline';
  mimeType: string;
  data: string;
}

export interface IUriImageMessagePart {
  type: 'image_uri';
  uri: string;
  mimeType?: string;
}

export type TUniversalMessagePart =
  | ITextMessagePart
  | IInlineImageMessagePart
  | IUriImageMessagePart;

/**
 * Tool call (OpenAI tool calling format).
 */
export interface IToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** State of a message in conversation history */
export type TMessageState = 'complete' | 'interrupted';

/**
 * Base message contract shared by all message variants.
 */
export interface IBaseMessage {
  /** Unique message identifier */
  id: string;
  /** Message creation timestamp */
  timestamp: Date;
  /** Whether this message is complete or was interrupted */
  state: TMessageState;
  /** Additional metadata */
  metadata?: TUniversalMessageMetadata;
}

export interface IUserMessage extends IBaseMessage {
  role: 'user';
  content: string;
  parts?: TUniversalMessagePart[];
  name?: string;
}

export interface IAssistantMessage extends IBaseMessage {
  role: 'assistant';
  /** Assistant response content (can be null when making tool calls) */
  content: string | null;
  parts?: TUniversalMessagePart[];
  toolCalls?: IToolCall[];
}

export interface ISystemMessage extends IBaseMessage {
  role: 'system';
  content: string;
  parts?: TUniversalMessagePart[];
  name?: string;
}

export interface IToolMessage extends IBaseMessage {
  role: 'tool';
  content: string;
  parts?: TUniversalMessagePart[];
  toolCallId: string;
  name?: string;
}

/**
 * Universal message union used across the SDK as the canonical contract.
 * Used for AI provider communication. Extracted from IHistoryEntry[] via filtering.
 */
export type TUniversalMessage = IUserMessage | IAssistantMessage | ISystemMessage | IToolMessage;

/**
 * Universal history entry — the base type for all records in conversation history.
 *
 * History is a universal timeline that records everything: AI chat messages,
 * system events, skill invocations, permission decisions, etc.
 * AI provider receives only chat entries (filtered and converted to TUniversalMessage).
 * TUI can render any range of entries.
 *
 * - append-only, read-only
 * - category + type for classification (free-form strings, no pre-defined enum)
 * - data holds type-specific structured content
 */
export interface IHistoryEntry<T = unknown> {
  /** Unique entry identifier */
  id: string;
  /** Entry creation timestamp */
  timestamp: Date;
  /** Top-level classification: 'chat', 'event', etc. */
  category: string;
  /** Sub-classification within category. Free-form, not pre-defined. */
  type: string;
  /** Type-specific structured data */
  data?: T;
}

/** Check if a history entry is a chat message (for AI provider filtering). */
export function isChatEntry(entry: IHistoryEntry): boolean {
  return entry.category === 'chat';
}

/**
 * Convert a chat history entry to TUniversalMessage for AI provider consumption.
 * Only call on entries where isChatEntry() returns true.
 */
export function chatEntryToMessage(entry: IHistoryEntry): TUniversalMessage {
  const data = entry.data as Record<string, unknown>;
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    state: (data?.state as TMessageState) ?? 'complete',
    role: data?.role as TUniversalMessageRole,
    content: (data?.content as string) ?? '',
    ...(data?.parts ? { parts: data.parts as TUniversalMessagePart[] } : {}),
    ...(data?.toolCalls ? { toolCalls: data.toolCalls as IToolCall[] } : {}),
    ...(data?.toolCallId ? { toolCallId: data.toolCallId as string } : {}),
    ...(data?.name ? { name: data.name as string } : {}),
  } as TUniversalMessage;
}

/**
 * Convert a TUniversalMessage to an IHistoryEntry for storage.
 */
export function messageToHistoryEntry(message: TUniversalMessage): IHistoryEntry {
  return {
    id: message.id,
    timestamp: message.timestamp,
    category: 'chat',
    type: message.role,
    data: { ...message },
  };
}

/**
 * Filter history entries and convert chat entries to TUniversalMessage[].
 * Used when passing conversation to AI provider.
 */
export function getMessagesForAPI(history: IHistoryEntry[]): TUniversalMessage[] {
  return history.filter(isChatEntry).map(chatEntryToMessage);
}

/**
 * Type guards for the canonical TUniversalMessage union.
 *
 * NOTE:
 * - These guards are owned by the `interfaces` layer and must not depend on managers/services.
 * - Call sites should use these guards instead of importing from manager layers.
 */
export function isUserMessage(message: TUniversalMessage): message is IUserMessage {
  return message.role === 'user';
}

export function isAssistantMessage(message: TUniversalMessage): message is IAssistantMessage {
  return message.role === 'assistant';
}

export function isSystemMessage(message: TUniversalMessage): message is ISystemMessage {
  return message.role === 'system';
}

export function isToolMessage(message: TUniversalMessage): message is IToolMessage {
  return message.role === 'tool';
}
