/**
 * Message factory functions for conversation messages.
 *
 * Extracted from conversation-history-manager.ts.
 *
 * Note: Type guards live in interfaces/messages.ts (SSOT) and are NOT duplicated here.
 */
import { randomId } from '../utils/random-id.js';

import type {
  IAssistantMessage,
  TUniversalMessageMetadata,
  ISystemMessage,
  IToolCall,
  IToolMessage,
  IUserMessage,
  TUniversalMessagePart,
  TMessageState,
} from '../interfaces/messages';

/** Create a user message. */
export function createUserMessage(
  content: string,
  options?: {
    name?: string;
    metadata?: TUniversalMessageMetadata;
    parts?: TUniversalMessagePart[];
  },
): IUserMessage {
  const message: IUserMessage = {
    id: randomId(),
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

/** Create an assistant message. */
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
    id: randomId(),
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

/** Create a system message. */
export function createSystemMessage(
  content: string,
  options?: {
    name?: string;
    metadata?: TUniversalMessageMetadata;
    parts?: TUniversalMessagePart[];
  },
): ISystemMessage {
  const message: ISystemMessage = {
    id: randomId(),
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

/** Create a tool message. */
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
    id: randomId(),
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
