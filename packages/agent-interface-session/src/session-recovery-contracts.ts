import type { IToolWaitRequest, TUniversalMessage } from '@robota-sdk/agent-core';

/** Discovery and input admission only; journal and current policy authorize continuation. */
export interface ISessionPendingExecution {
  executionId: string;
  requests: readonly IToolWaitRequest[];
}

/** One Session-owned projection; history and recovery identity must travel together. */
export interface ISessionConversationSnapshot {
  id: string;
  cwd: string;
  messages: TUniversalMessage[];
  pendingExecution?: ISessionPendingExecution;
}
