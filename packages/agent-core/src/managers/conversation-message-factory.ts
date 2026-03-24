/**
 * Type guard functions and message factory functions for conversation messages.
 *
 * Extracted from conversation-history-manager.ts.
 */
import { randomUUID } from 'node:crypto';

import type {
  IAssistantMessage,
  TUniversalMessageMetadata,
  ISystemMessage,
  IToolCall,
  IToolMessage,
  TUniversalMessage,
  IUserMessage,
  TUniversalMessagePart,
  TMessageState,
} from '../interfaces/messages';

/** Check if a message is a user message */
export function isUserMessage(message: TUniversalMessage): message is IUserMessage {
  return message.role === 'user';
}

/** Check if a message is an assistant message */
export function isAssistantMessage(message: TUniversalMessage): message is IAssistantMessage {
  return message.role === 'assistant';
}

/** Check if a message is a system message */
export function isSystemMessage(message: TUniversalMessage): message is ISystemMessage {
  return message.role === 'system';
}

/** Check if a message is a tool message */
export function isToolMessage(message: TUniversalMessage): message is IToolMessage {
  return message.role === 'tool';
}

/** Create a user message. @internal */
export function createUserMessage(
  content: string,
  options?: {
    name?: string;
    metadata?: TUniversalMessageMetadata;
    parts?: TUniversalMessagePart[];
  },
): IUserMessage {
  const message: IUserMessage = {
    id: randomUUID(),
    role: 'user',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
  if (options?.name) message.name = options.name;
  if (options?.metadata) message.metadata = options.metadata;
  if (options?.parts) message.parts = options.parts;
  return message;
}

/** Create an assistant message. @internal */
export function createAssistantMessage(
  content: string | null,
  options?: {
    toolCalls?: IToolCall[];
    metadata?: TUniversalMessageMetadata;
    parts?: TUniversalMessagePart[];
    state?: TMessageState;
  },
): IAssistantMessage {
  const message: IAssistantMessage = {
    id: randomUUID(),
    role: 'assistant',
    content,
    state: options?.state ?? 'complete',
    timestamp: new Date(),
  };
  if (options?.toolCalls) message.toolCalls = options.toolCalls;
  if (options?.metadata) message.metadata = options.metadata;
  if (options?.parts) message.parts = options.parts;
  return message;
}

/** Create a system message. @internal */
export function createSystemMessage(
  content: string,
  options?: {
    name?: string;
    metadata?: TUniversalMessageMetadata;
    parts?: TUniversalMessagePart[];
  },
): ISystemMessage {
  const message: ISystemMessage = {
    id: randomUUID(),
    role: 'system',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
  if (options?.name) message.name = options.name;
  if (options?.metadata) message.metadata = options.metadata;
  if (options?.parts) message.parts = options.parts;
  return message;
}

/** Create a tool message. @internal */
export function createToolMessage(
  content: string,
  options: {
    toolCallId: string;
    name?: string;
    metadata?: TUniversalMessageMetadata;
    parts?: TUniversalMessagePart[];
  },
): IToolMessage {
  const message: IToolMessage = {
    id: randomUUID(),
    role: 'tool',
    content,
    toolCallId: options.toolCallId,
    state: 'complete',
    timestamp: new Date(),
  };
  if (options.name) message.name = options.name;
  if (options.metadata) message.metadata = options.metadata;
  if (options.parts) message.parts = options.parts;
  return message;
}
