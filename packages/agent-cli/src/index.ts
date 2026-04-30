// @robota-sdk/agent-cli — Terminal TUI product

// CLI entry point
export { startCli } from './cli.js';
export { createManagedShellProcessRunner } from './background/managed-shell-process-runner.js';
export {
  ChildProcessSubagentRunner,
  createChildProcessSubagentRunnerFactory,
  GitWorktreeIsolationAdapter,
  createGitWorktreeIsolationAdapter,
} from './subagents/index.js';
export type {
  IChildProcessSubagentRunnerOptions,
  IGitWorktreeIsolationAdapterOptions,
} from './subagents/index.js';
export type { IManagedShellProcessRunnerOptions } from './background/managed-shell-process-runner.js';

// Local CLI types
export type { ITerminalOutput, ISpinner } from './types.js';
