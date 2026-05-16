export { SubagentManager } from './subagent-manager.js';
export {
  GitWorktreeIsolationAdapter,
  createGitWorktreeIsolationAdapter,
} from './git-worktree-isolation-adapter.js';
export type { IGitWorktreeIsolationAdapterOptions } from './git-worktree-isolation-adapter.js';
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
