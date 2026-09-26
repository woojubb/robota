import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { IWireHistoryEntry, TClientMessage } from './wire-messages.js';

type TSessionQueryMessage = Extract<
  TClientMessage,
  {
    type:
      | 'get-messages'
      | 'get-history'
      | 'get-context'
      | 'get-commands'
      | 'get-status'
      | 'get-executing'
      | 'get-pending'
      | 'get-execution-workspace';
  }
>;

export function isSessionQueryMessage(msg: TClientMessage): msg is TSessionQueryMessage {
  return (
    msg.type === 'get-messages' ||
    msg.type === 'get-history' ||
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
    deliver({ type: 'history', entries: session.getFullHistory().map(toWireHistoryEntry) });
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
    deliver({ type: 'pending', pending: session.getPendingPrompt() });
  }
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
