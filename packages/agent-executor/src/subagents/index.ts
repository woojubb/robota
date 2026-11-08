export { subagentExecutionRoot } from './execution-root.js';
// A consumer of `subagentExecutionRoot` must be able to NAME what it must pass, so the
// envelope type is exported; a mechanical check guards this rather than a note.
export type { ISubagentExecutionEnvelope } from './execution-root.js';
export { SubagentManager } from './subagent-manager.js';
export {
  WorktreeSubagentRunner,
  createWorktreeSubagentRunner,
} from './worktree-subagent-runner.js';
export type {
  IPreparedSubagentWorktree,
  ISubagentWorktreeAdapter,
  ISubagentWorktreePrepareRequest,
  IWorktreeSubagentRunnerOptions,
} from './worktree-subagent-runner.js';
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
} from './types.js';
