/**
 * What the platform lends the framework: the one object a composition root passes as `host`.
 *
 * The framework is platform-neutral, so it has no host default. A capability the host leaves out is
 * absent, and the code that would have used it says so plainly: it refuses, or does nothing where
 * that is the documented meaning. A browser or a Worker passes `{}`; a Node host passes
 * `createNodeFrameworkHost` from `@robota-sdk/agent-framework/node`.
 *
 * Deliberately not here: the working directory (it belongs to a session, not to a platform), project
 * file access (it is minted from a workspace trust decision), and the stores and sinks that already
 * mean "off" when absent.
 */

import type {
  IFileSystem,
  IFileSystemAsync,
  IHookTypeExecutor,
  IToolWithEventService,
  TEnvResolver,
  TResolveInWorkspace,
} from '@robota-sdk/agent-core';
import type { IBackgroundTaskRunner, IObserverFailure } from '@robota-sdk/agent-executor';
import type { IFileSessionLoggerOptions } from '@robota-sdk/agent-session';
import type { ISandboxClient } from '@robota-sdk/agent-tools';
import type { ICommandSessionReplayValidationReport } from '../command-api/host-context-types.js';
import type { IGitProcessPort } from '../git/git-process.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/types.js';

/**
 * A value that follows one asynchronous call chain, as `AsyncLocalStorage` does on Node. Inside
 * `run(value, fn)`, `getStore()` returns `value` for everything `fn` starts, and `undefined` outside.
 */
export interface IAsyncScope<T> {
  run<R>(value: T, fn: () => R): R;
  getStore(): T | undefined;
}

export interface IFrameworkHost {
  /** The user's home directory; absent, a session has none and `/cd ~` is refused. */
  readonly homeDirectory?: string;
  /** Resolves a path inside a workspace for the permission gate; absent, the gate cannot place it. */
  readonly createWorkspacePathResolver?: (cwd: string) => TResolveInWorkspace;
  /** Resolves symlinks to a real path; absent, a trusted project cannot be checked and is refused. */
  readonly canonicalizePath?: (path: string) => string;
  /** Registers a function to run as the process ends; absent, a log loses the buffered tail of an abnormal exit. */
  readonly registerExitFlush?: NonNullable<IFileSessionLoggerOptions['registerExitFlush']>;
  /** Reads a named environment variable; absent, every `$ENV:` reference reads as unset. */
  readonly env?: TEnvResolver;
  /**
   * File access for reading, diffing and loading. Absent: an Edit diff carries its removed and added
   * lines but no context lines from the file; a project diff is refused, since containment cannot be
   * proven; `/cd` refuses; and naming `pluginDirectories` or a manifest's local entries is refused.
   */
  readonly files?: {
    readonly sync: IFileSystem;
    readonly async: IFileSystemAsync;
    /** Whether `candidate` is inside `root` once symlinks are resolved. */
    isPathInside(root: string, candidate: string): boolean;
  };
  /** Runs git for project status and diff; absent, project status reports `failed`. */
  readonly git?: IGitProcessPort;
  /**
   * Lists the remotes of `cwd`'s repository for the permission classifier; absent, none is known.
   * Separate from `git` because it must see the environment a judged `git push` runs in, where
   * `git` runs in a scrubbed one.
   */
  readonly readGitRemotes?: (cwd: string) => Promise<string[]>;
  /** Builds the executors that run a hook's handlers; absent, none run and a declared hook is refused. */
  readonly createHookExecutors?: (options: { shell?: string }) => IHookTypeExecutor[];
  /**
   * Builds the background task runners, given the shell a command task runs under when the product
   * chose one; absent, the manager refuses a task with "No background task runner registered for kind".
   */
  readonly createBackgroundTaskRunners?: (shellExecutable?: string) => IBackgroundTaskRunner[];
  /** Builds the session's default tool tier; absent, a session has no default tier. */
  readonly createDefaultTools?: (context: {
    cwd: string;
    sandboxClient?: ISandboxClient;
  }) => IToolWithEventService[];
  /** Reports a failed background observer; absent, the executor writes its own log line. */
  readonly reportObserverFailure?: <TEvent>(
    failure: IObserverFailure<TEvent>,
    code?: string,
  ) => void;
  /**
   * Makes a scope that follows an async call chain. Absent, the skill router cannot tell overlapping
   * commands apart, so it runs one user or remote command at a time (a second is refused), admits a
   * model command only when no such command runs or that command has started its own turn, and
   * refuses a forked skill, whose resource window needs a scope, before it starts.
   */
  readonly createAsyncScope?: <T>() => IAsyncScope<T>;
  /** Whether the host can write project files; absent or false, a project permission cannot be persisted. */
  readonly supportsProjectMutation?: boolean;
  /**
   * Reads session `sessionId`'s project log and reports whether it replays. A session holds no keys,
   * so a sealed log is reported through `ArtifactLockedError`, never opened. Absent, the session
   * cannot read its log and `/validate-session` fails with an error naming this member.
   */
  readonly validateSessionReplayLog?: (
    projectAccess: TWorkspaceProjectAccess,
    sessionId: string,
  ) => ICommandSessionReplayValidationReport;
}
