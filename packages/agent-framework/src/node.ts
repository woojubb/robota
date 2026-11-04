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
import { createGitProcess } from './git/git-process.js';
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
    createHookExecutors: ({ shell }) => [new CommandExecutor(shell), new HttpExecutor()],
    createBackgroundTaskRunners: () => createDefaultBackgroundTaskRunners(),
    createDefaultTools: options.createDefaultTools,
    reportObserverFailure: reportObserverFailureAsProcessWarning,
    createAsyncScope: <T>() => new AsyncLocalStorage<T>(),
    supportsProjectMutation: supportsWorkspaceProjectMutation(),
  };
}
