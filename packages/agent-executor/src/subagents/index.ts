export { subagentExecutionRoot } from './execution-root.js';
// ARCH-037: a consumer of `subagentExecutionRoot` could not NAME what it must pass. Same
// defect ARCH-025 fixed for `IScheduleEditPatch`, on a function ARCH-031 changed one branch
// later — which is why this landed with a mechanical check rather than another note.
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
