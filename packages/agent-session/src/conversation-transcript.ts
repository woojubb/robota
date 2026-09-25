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

import { peerDriverOf, printablePeerDriver } from '@robota-sdk/agent-core';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

function encode(content: unknown): string {
  return JSON.stringify(typeof content === 'string' ? content : (content ?? ''));
}

/**
 * The same peer attribution the model request carries (agent-core `peerDriverOf`), and the same
 * printable form of the id, which arrives from the sending side.
 */
function userLabel(message: TUniversalMessage): string {
  const peer = peerDriverOf(message);
  return peer ? `user [from ${JSON.stringify(printablePeerDriver(peer))}]` : 'user';
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
