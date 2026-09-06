import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { TClientMessage } from './ws-protocol.js';

type TSessionQueryMessage = Extract<
  TClientMessage,
  {
    type:
      | 'get-messages'
      | 'get-context'
      | 'get-executing'
      | 'get-pending'
      | 'get-execution-workspace';
  }
>;

export function isSessionQueryMessage(msg: TClientMessage): msg is TSessionQueryMessage {
  return (
    msg.type === 'get-messages' ||
    msg.type === 'get-context' ||
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
  } else if (msg.type === 'get-context') {
    deliver({ type: 'context', state: session.getContextState() });
  } else if (msg.type === 'get-executing') {
    deliver({ type: 'executing', executing: session.isExecuting() });
  } else if (msg.type === 'get-execution-workspace') {
    deliver({ type: 'execution_workspace_event', snapshot: session.getExecutionWorkspaceSnapshot() });
  } else {
    deliver({ type: 'pending', pending: session.getPendingPrompt() });
  }
}
