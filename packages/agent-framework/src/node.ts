// @robota-sdk/agent-framework/node — what only a Node host can provide. The main entry is
// platform-neutral (ARCHITECTURE.md "Runtime platforms") and takes each capability by injection as
// `host`; this builds the host a Node composition root passes.

import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';

import {
  CommandExecutor,
  HttpExecutor,
  isPathInside,
  processEnvResolver,
} from '@robota-sdk/agent-core/node';
import {
  createDefaultBackgroundTaskRunners,
  reportObserverFailureAsProcessWarning,
} from '@robota-sdk/agent-executor/node';
import {
  createNodeWorkspacePathResolver,
  registerProcessExitFlush,
} from '@robota-sdk/agent-session/node';

import { NodeFileSystem, NodeFileSystemAsync } from './adapters/node-file-system.js';
import { createGitProcess } from './git/node-git-process.js';
import { readNodeGitRemotes } from './git/read-git-remotes.js';
import { validateWorkspaceSessionReplayLog } from './interactive/workspace-session-replay-validation.js';
import { supportsWorkspaceProjectMutation } from './workspace-trust/project-relative-writer.js';

import type { IFrameworkHost } from './host/framework-host.js';

export interface ICreateNodeFrameworkHostOptions {
  /**
   * Builds a session's default tool tier, normally `createDefaultTools` from
   * `@robota-sdk/agent-tool-defaults`. The framework does not import that package itself, so the
   * composition root names it. Pass `() => []` for a host whose sessions have no default tier.
   */
  readonly createDefaultTools: NonNullable<IFrameworkHost['createDefaultTools']>;
}

/** The host a Node process lends the framework: its files, git, environment, processes and exit hook. */
export function createNodeFrameworkHost(options: ICreateNodeFrameworkHostOptions): IFrameworkHost {
  if (typeof options?.createDefaultTools !== 'function') {
    throw new Error(
      "createNodeFrameworkHost requires `createDefaultTools`: the factory that builds a session's " +
        'default tool tier. Pass `createDefaultTools` from `@robota-sdk/agent-tool-defaults`, or ' +
        '`() => []` for sessions with no default tier.',
    );
  }
  return {
    homeDirectory: homedir(),
    createWorkspacePathResolver: (cwd) => createNodeWorkspacePathResolver(cwd),
    // Throws on a missing directory, as the session's own checks always did.
    canonicalizePath: (path) => realpathSync(path),
    registerExitFlush: registerProcessExitFlush,
    env: processEnvResolver,
    files: {
      sync: new NodeFileSystem(),
      async: new NodeFileSystemAsync(),
      isPathInside,
    },
    git: createGitProcess(),
    readGitRemotes: readNodeGitRemotes,
    createHookExecutors: ({ shell }) => [new CommandExecutor(shell), new HttpExecutor()],
    createBackgroundTaskRunners: createDefaultBackgroundTaskRunners,
    createDefaultTools: options.createDefaultTools,
    reportObserverFailure: reportObserverFailureAsProcessWarning,
    createAsyncScope: <T>() => new AsyncLocalStorage<T>(),
    supportsProjectMutation: supportsWorkspaceProjectMutation(),
    // A session holds no keys of its own, so the log is read as plain and a sealed one is reported
    // as sealed (`ArtifactLockedError`, `no-keys`) instead of being opened.
    validateSessionReplayLog: (projectAccess, sessionId) =>
      validateWorkspaceSessionReplayLog(projectAccess, sessionId, { sealing: 'plain' }),
  };
}

// Providers, plugins and user-local: the Node-only parts of files that are otherwise neutral. The
// neutral modules take the file system as a required parameter; this is the adapter a Node
// composition root passes.
export { NodeFileSystem, NodeFileSystemAsync } from './adapters/node-file-system.js';
export { loadOrgPolicy } from './command-api/org-policy/org-policy-loader.js';
export { checkNodeHostSettingsFile } from './command-api/provider/node-host-settings-check.js';

// The subagent transcript: a log file written and paged through Node's `fs`.
export {
  createSubagentLogger,
  migrateSubagentTranscripts,
  readSubagentTranscriptPage,
  resolveSubagentLogDir,
  resolveSubagentLogSessionId,
  resolveSubagentTranscriptPath,
} from './assembly/subagent-logger.js';
export type {
  IReadSubagentTranscriptPageOptions,
  ISubagentTranscriptMigration,
  ISubagentTranscriptPage,
  ISubagentTranscriptUnreadable,
} from './assembly/subagent-logger.js';

// The git process that runs `git` for project status and diff.
export {
  createGitProcess,
  gitEnvironment,
  GIT_DEFAULT_TIMEOUT_MS,
  GIT_ENV_DENYLIST,
  GIT_MAX_OUTPUT_BYTES,
} from './git/node-git-process.js';
export type { ICreateGitProcessOptions } from './git/node-git-process.js';
// The branch a checkout is on, read from its `.git` directory.
export { resolveGitBranchFromNodeHost } from './git/git-branch.js';

// The replay-validation report of a session's project log, read through the workspace session store.
export { validateWorkspaceSessionReplayLog } from './interactive/workspace-session-replay-validation.js';

// Settings, contribution roots, transport settings and the package version: the file-backed halves
// of modules whose neutral halves are on the main entry. The main entry takes each as a parameter
// (`IHostSettingsSource`, `ISettingsDocumentStore`, `IContributionSource`,
// `ITransportSettingsRepository`); a Node composition root builds them here.
export { createNodeHostSettingsSource } from './config/node-host-settings-source.js';
export { createNodeHostSettingsStore } from './config/node-host-settings-store.js';
export {
  deleteSettings,
  readSettings,
  updateModelInSettings,
  writeSettings,
} from './config/settings-io.js';
export { resetUserConfig } from './config/reset-user-config.js';
export type { IResetUserConfigResult } from './config/reset-user-config.js';
export {
  createDefaultUserContributionSources,
  createNodeHostContributionSource,
} from './contributions/node-host-contribution-source.js';
export { createFileTransportSettingsRepository } from './transport-host/transport-settings-repository.js';
export { readPackageVersion } from './utils/read-package-version.js';

// Workspace trust: how a Node host builds a trusted session. Its git identity, persistent grant
// store and stable file operations are composed into a `WorkspaceTrustService` by
// `createNodeWorkspaceTrustService`. A host with none of these passes
// `createRestrictedWorkspaceProjectAccess` from the main entry.
export {
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceTrustService,
  createNodeWorkspaceTrustStore,
} from './workspace-trust/node-host-workspace-trust.js';
export type { INodeWorkspaceTrustStoreOptions } from './workspace-trust/node-host-workspace-trust.js';
export { createNodeWorkspaceProjectFiles } from './workspace-trust/node-project-files.js';
export { inspectPreTrustProjectPaths } from './workspace-trust/pretrust-contribution-inspector.js';
export type {
  IPreTrustProjectPathInspection,
  TPreTrustProjectPathKind,
} from './workspace-trust/pretrust-contribution-inspector.js';
export { supportsWorkspaceProjectMutation } from './workspace-trust/project-relative-writer.js';

// Lane W (#3693): edit checkpoints and the stores that keep a session. They seal and migrate through
// `@robota-sdk/agent-session/node`; a host with no files passes its own `IEditCheckpointStore` and
// `IInteractiveSessionStore`, which the main entry types.
export { EditCheckpointStore } from './checkpoints/edit-checkpoint-store.js';
export { createDirectoryEditCheckpointState } from './checkpoints/edit-checkpoint-state-storage.js';
export type { IEditCheckpointStateStorage } from './checkpoints/edit-checkpoint-state-storage.js';
export { migrateWorkspaceEditCheckpoints } from './checkpoints/edit-checkpoint-migration.js';
export type {
  IEditCheckpointMigration,
  IMigrateEditCheckpointsOptions,
  TEditCheckpointKeptPlainReason,
} from './checkpoints/edit-checkpoint-migration.js';
export {
  createNodeHostSessionStore,
  createNodeToolResultSpillStore,
  createProjectSessionStore,
  createUserPromptHistoryFile,
  createUserSessionStore,
  sweepStaleToolResultSpillDirectories,
} from './interactive/node-session-stores.js';
export {
  WorkspaceSessionLogSink,
  WorkspaceSessionLogSource,
} from './interactive/workspace-session-io.js';
export {
  WorkspaceProjectSessionStore,
  projectSessionClaimsDirectory,
} from './interactive/workspace-session-store.js';
export {
  migrateWorkspaceProjectSessionLogs,
  migrateWorkspaceProjectSessionRecords,
} from './interactive/workspace-session-migration.js';
export type {
  IMigrateWorkspaceProjectStateOptions,
  IWorkspaceSessionLogMigration,
  IWorkspaceSessionRecordMigration,
} from './interactive/workspace-session-migration.js';
