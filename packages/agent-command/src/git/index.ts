// The git process port and the status/diff readers moved to `@robota-sdk/agent-framework` (#3282
// §4c) so the Project panel's session-level reads and this command run through the exact same
// functions; re-exported here so an existing `from '@robota-sdk/agent-command'` import keeps working.
export {
  createGitProcess,
  gitEnvironment,
  type ICreateGitProcessOptions,
  type IGitProcessPort,
  type IGitProcessRunOptions,
  type TGitProcessFailureReason,
  type TGitProcessOutcome,
} from '@robota-sdk/agent-framework';
export {
  createGitCommandEntry,
  createGitCommandModule,
  executeGitCommand,
  GitCommandSource,
  type IGitCommandModuleOptions,
  type TGitCommandContext,
} from './git-command-module.js';
