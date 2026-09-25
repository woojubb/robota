/**
 * The one text rendering of a conversation that is handed to a model as prompt input.
 *
 * Compaction summarises it and the advisor reads it. Both need the same things kept: which tool the
 * model called with which arguments, what came back, and who wrote each user message — a message a
 * peer session sent is not the operator's own words and must not read as if it were.
 *
 * Every message is exactly one line: the label is written here and the content is JSON-encoded, so
 * no newline inside a message, a tool result or a peer's text can start a line of its own. That is
 * what keeps a peer from writing an unmarked `user:` line or a tool result from closing a block the
 * reader was told to trust.
 */

import type { TUniversalMessage } from '@robota-sdk/agent-core';

/** Driver ids of this prefix mark a user message sent by another session, not the operator. */
const PEER_DRIVER_PREFIX = 'peer:';

function encode(content: unknown): string {
  return JSON.stringify(typeof content === 'string' ? content : (content ?? ''));
}

function userLabel(message: TUniversalMessage): string {
  const driverId = message.metadata?.['driverId'];
  return typeof driverId === 'string' && driverId.startsWith(PEER_DRIVER_PREFIX)
    ? `user [from ${JSON.stringify(driverId)}]`
    : 'user';
}

function formatMessage(message: TUniversalMessage): string[] {
  switch (message.role) {
    case 'user':
      return [`${userLabel(message)}: ${encode(message.content)}`];
    case 'assistant': {
      const lines: string[] = [];
      if (message.content !== null && message.content !== '') {
        lines.push(`assistant: ${encode(message.content)}`);
      }
      for (const call of message.toolCalls ?? []) {
        lines.push(
          `assistant tool call ${JSON.stringify(call.function.name)} [${JSON.stringify(call.id)}]: ${encode(call.function.arguments)}`,
        );
      }
      return lines.length > 0 ? lines : [`assistant: ""`];
    }
    case 'tool':
      return [
        `tool result${message.name ? ` ${JSON.stringify(message.name)}` : ''} [${JSON.stringify(message.toolCallId)}]: ${encode(message.content)}`,
      ];
    case 'system':
      return [`system: ${encode(message.content)}`];
  }
}

/**
 * Render each message as one entry, in order. An entry is one line, except an assistant message
 * with several tool calls, which is one line per call. One entry per message so a caller that must
 * drop the oldest part of a long conversation can drop whole messages.
 */
export function formatConversationEntries(history: readonly TUniversalMessage[]): string[] {
  return history.map((message) => formatMessage(message).join('\n'));
}
