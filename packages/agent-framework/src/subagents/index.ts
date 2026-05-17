export { createInProcessSubagentRunner } from './in-process-subagent-runner.js';
export type {
  IInProcessSubagentRunnerDeps,
  TSubagentRunnerFactory,
} from './in-process-subagent-runner.js';

// ── Child-process subagent runner ──────────────────────────
export {
  ChildProcessSubagentRunner,
  createChildProcessSubagentRunnerFactory,
} from './child-process-subagent-runner.js';
export type { IChildProcessSubagentRunnerOptions } from './child-process-subagent-runner.js';
export {
  isSubagentWorkerChildMessage,
  isSubagentWorkerParentMessage,
} from './child-process-subagent-ipc.js';
export type {
  ISubagentWorkerStartPayload,
  TSubagentWorkerChildMessage,
  TSubagentWorkerParentMessage,
  TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';
export type {
  IPreparedSubagentWorktree,
  ISubagentWorktreeAdapter,
  ISubagentWorktreePrepareRequest,
  IWorktreeSubagentRunnerOptions,
} from '@robota-sdk/agent-executor';
export type {
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobStart,
  ISubagentJobState,
  ISubagentManager,
  ISubagentManagerOptions,
  ISubagentRunner,
  ISubagentSpawnRequest,
  TSubagentJobMode,
  TSubagentJobStatus,
} from '@robota-sdk/agent-executor';
