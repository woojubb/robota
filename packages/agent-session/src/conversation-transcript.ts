/**
 * The one text rendering of a conversation that is handed to a model as prompt input.
 *
 * Compaction summarises it and the advisor reads it. Both need the same things kept: which tool the
 * model called with which arguments, what came back, and who wrote each user message — a message a
 * peer session sent is not the operator's own words and must not read as if it were.
 */

import type { TUniversalMessage } from '@robota-sdk/agent-core';

/** Driver ids of this prefix mark a user message sent by another session, not the operator. */
const PEER_DRIVER_PREFIX = 'peer:';

function textOf(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function userLabel(message: TUniversalMessage): string {
  const driverId = message.metadata?.['driverId'];
  return typeof driverId === 'string' && driverId.startsWith(PEER_DRIVER_PREFIX)
    ? `user [from ${driverId}]`
    : 'user';
}

function formatMessage(message: TUniversalMessage): string {
  switch (message.role) {
    case 'user':
      return `${userLabel(message)}: ${textOf(message.content)}`;
    case 'assistant': {
      const lines: string[] = [];
      if (message.content !== null && message.content !== '') {
        lines.push(`assistant: ${textOf(message.content)}`);
      }
      for (const call of message.toolCalls ?? []) {
        lines.push(
          `assistant tool call ${call.function.name} [${call.id}]: ${call.function.arguments}`,
        );
      }
      return lines.length > 0 ? lines.join('\n') : 'assistant: ';
    }
    case 'tool':
      return `tool result${message.name ? ` ${message.name}` : ''} [${message.toolCallId}]: ${textOf(message.content)}`;
    case 'system':
      return `system: ${textOf(message.content)}`;
  }
}

/**
 * Render each message as one block of text, in order. One block per message so a caller that must
 * drop the oldest part of a long conversation can drop whole messages.
 */
export function formatConversationEntries(history: readonly TUniversalMessage[]): string[] {
  return history.map(formatMessage);
}
