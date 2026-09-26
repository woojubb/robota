import { listOpenPrompts } from './open-prompts.js';

import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { IWireHistoryEntry, TClientMessage, TServerMessage } from './wire-messages.js';

type TSessionQueryMessage = Extract<
  TClientMessage,
  {
    type:
      | 'get-messages'
      | 'get-history'
      | 'get-prompts'
      | 'get-context'
      | 'get-commands'
      | 'get-status'
      | 'get-executing'
      | 'get-pending'
      | 'get-execution-workspace';
  }
>;

/**
 * #3189: the most serialized history one `history` frame carries. Well under the tightest outbound
 * budget (an attached terminal's, 1 MiB), so a client reading page after page is never mistaken for
 * one that stopped reading.
 */
export const HISTORY_PAGE_MAX_BYTES = 256 * 1024;

const utf8 = new TextEncoder();

export function isSessionQueryMessage(msg: TClientMessage): msg is TSessionQueryMessage {
  return (
    msg.type === 'get-messages' ||
    msg.type === 'get-history' ||
    msg.type === 'get-prompts' ||
    msg.type === 'get-context' ||
    msg.type === 'get-commands' ||
    msg.type === 'get-status' ||
    msg.type === 'get-executing' ||
    msg.type === 'get-pending' ||
    msg.type === 'get-execution-workspace'
  );
}

export function handleSessionQueryMessage(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: TSessionQueryMessage,
): void {
  if (msg.type === 'get-messages') {
    deliver({ type: 'messages', messages: session.getMessages() });
  } else if (msg.type === 'get-history') {
    deliver(historyPage(session, msg.fromIndex ?? 0));
  } else if (msg.type === 'get-prompts') {
    for (const frame of listOpenPrompts(session)) deliver(frame);
  } else if (msg.type === 'get-context') {
    deliver({ type: 'context', state: session.getContextState() });
  } else if (msg.type === 'get-commands') {
    deliver({ type: 'commands', commands: session.listCommands(), skills: session.listSkills() });
  } else if (msg.type === 'get-status') {
    deliver({ type: 'session_status', status: session.getStatusSnapshot() });
  } else if (msg.type === 'get-executing') {
    deliver({ type: 'executing', executing: session.isExecuting() });
  } else if (msg.type === 'get-execution-workspace') {
    deliver({
      type: 'execution_workspace_event',
      snapshot: session.getExecutionWorkspaceSnapshot(),
    });
  } else {
    deliver(pendingFrame(session));
  }
}

/** The next queued prompt and how many wait, as the session reports them now. */
export function pendingFrame(
  session: IProtocolSession,
): Extract<TServerMessage, { type: 'pending' }> {
  return {
    type: 'pending',
    pending: session.getPendingPrompt(),
    pendingCount: session.getPendingCount(),
  };
}

/**
 * The history from `fromIndex`, as many entries as fit {@link HISTORY_PAGE_MAX_BYTES}. At least one
 * entry is sent while any remain, so a client always moves forward, even past one larger entry.
 */
function historyPage(
  session: IProtocolSession,
  fromIndex: number,
): Extract<TServerMessage, { type: 'history' }> {
  const history = session.getFullHistory();
  const total = history.length;
  const startIndex = Math.min(fromIndex, total);
  const entries: IWireHistoryEntry[] = [];
  let bytes = 0;
  for (let index = startIndex; index < total; index += 1) {
    const entry = toWireHistoryEntry(history[index]!);
    const size = utf8.encode(JSON.stringify(entry)).byteLength;
    if (entries.length > 0 && bytes + size > HISTORY_PAGE_MAX_BYTES) break;
    entries.push(entry);
    bytes += size;
  }
  return { type: 'history', startIndex, total, entries };
}

function toWireHistoryEntry(
  entry: ReturnType<IProtocolSession['getFullHistory']>[number],
): IWireHistoryEntry {
  return { ...entry, timestamp: toIsoTimestamp(entry.timestamp) };
}

/**
 * The declared type is `Date`, but a resumed session's entries were read back from JSON unrevived, so
 * their `timestamp` is already the ISO string the store wrote. Either way the wire carries that string.
 */
function toIsoTimestamp(timestamp: Date | string): string {
  return typeof timestamp === 'string' ? timestamp : timestamp.toISOString();
}
