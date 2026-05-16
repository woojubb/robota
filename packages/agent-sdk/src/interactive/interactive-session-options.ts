/**
 * Public option interfaces for InteractiveSession construction and configuration.
 *
 * IInteractiveSessionStandardOptions: standard construction (cwd + provider).
 * IInteractiveSessionInjectedOptions: test/advanced injection of a pre-built session.
 * IInitOptions: internal async init shape passed to createInteractiveSession().
 */

import type { Session } from '@robota-sdk/agent-sessions';
import type { ICompactEvent } from '@robota-sdk/agent-sessions';
import type { IAIProvider, IContextWindowState, TToolArgs } from '@robota-sdk/agent-core';
import type { IBackgroundTaskRunner } from '../background-tasks/index.js';
import type { TSubagentRunnerFactory } from '../subagents/index.js';
import type { ICommandHostAdapters, ICommandModule, ICommandResult } from '../commands/index.js';
import type { TShellExecFn } from '../utils/skill-prompt.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { ICreateSessionOptions } from '../assembly/index.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { TInteractivePermissionHandler } from './types.js';
import type { IInteractiveSessionStore } from './session-persistence.js';
import type { IEditCheckpointRecorder } from '../checkpoints/edit-checkpoint-types.js';
import type { IReversibleExecutionOptions } from '../reversible-execution/index.js';
import type { ISandboxClient, IWorkspaceManifest } from '@robota-sdk/agent-tools';

/** Standard construction: cwd + provider. Config/context loaded internally. */
export interface IInteractiveSessionStandardOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  sessionStore?: IInteractiveSessionStore;
  sessionName?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  /** Skip AGENTS.md/CLAUDE.md loading and plugin discovery. */
  bare?: boolean;
  /** Pre-approved tool names passed to createSession. */
  allowedTools?: string[];
  /** Text to append to the system prompt. */
  appendSystemPrompt?: string;
  /** Override config language (e.g., "ko", "en"). Injected into system prompt. */
  language?: string;
  /** Runtime-composed background task runners. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Optional command modules composed into this session. */
  commandModules?: readonly ICommandModule[];
  /** Host adapters available to composed command modules. */
  commandHostAdapters?: ICommandHostAdapters;
  /** Shell exec function for preprocessing `` !`cmd` `` patterns in skills — injected from composition root. */
  shellExec?: TShellExecFn;
  /** Model-visible command descriptors derived from the composed command executor. */
  commandDescriptors?: readonly ICapabilityDescriptor[];
  /** Model command execution bridge. */
  modelCommandExecutor?: (command: string, args: string) => Promise<ICommandResult | null>;
  /** Predicate for commands allowed through the model command execution bridge. */
  isModelCommandInvocable?: (command: string) => boolean;
  /** Preloaded config to avoid duplicate discovery when caller needs it too. */
  config?: IResolvedConfig;
  /** Opt-in local-first reversible execution policy for write/shell tools. */
  reversibleExecution?: IReversibleExecutionOptions;
  /** Optional provider sandbox client used by sandbox-aware built-in tools. */
  sandboxClient?: ISandboxClient;
  /** Fresh-session workspace manifest applied through the sandbox client. */
  workspaceManifest?: IWorkspaceManifest;
  /** Sandbox target root for workspace manifest entries. Defaults to /workspace. */
  sandboxWorkspaceRoot?: string;
  /** Provider sandbox snapshot id to restore before replaying saved messages. */
  sandboxSnapshotId?: string;
  /** Name reported to the underlying Robota agent config. Defaults to 'agent'. */
  agentName?: string;
}

/** Test/advanced construction: inject pre-built session directly. */
export interface IInteractiveSessionInjectedOptions {
  session: Session;
  cwd?: string;
  provider?: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  sessionStore?: IInteractiveSessionStore;
  sessionName?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  /** Optional command modules composed into this injected session. */
  commandModules?: readonly ICommandModule[];
  /** Host adapters available to composed command modules. */
  commandHostAdapters?: ICommandHostAdapters;
}

/** Union of standard and injected construction options. */
export type TInteractiveSessionOptions =
  | IInteractiveSessionStandardOptions
  | IInteractiveSessionInjectedOptions;

/** Internal async init options (not re-exported). */
export interface IInitOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  resumeSessionId?: string;
  forkSession?: boolean;
  onTextDelta: (delta: string) => void;
  onContextUpdate?: (state: IContextWindowState) => void;
  onCompactEvent?: (event: ICompactEvent) => void;
  onToolExecution: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
  }) => void;
  /** Skip AGENTS.md/CLAUDE.md loading and plugin discovery. */
  bare?: boolean;
  /** Pre-approved tool names passed to createSession. */
  allowedTools?: string[];
  /** Text to append to the system prompt. */
  appendSystemPrompt?: string;
  /** Override config language (e.g., "ko", "en"). Injected into system prompt. */
  language?: string;
  /** Runtime-composed background task runners. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Optional command modules composed into this session. */
  commandModules?: readonly ICommandModule[];
  /** Model-visible command descriptors derived from the composed command executor. */
  commandDescriptors?: readonly ICapabilityDescriptor[];
  /** Model command execution bridge. */
  modelCommandExecutor?: (command: string, args: string) => Promise<ICommandResult | null>;
  /** Predicate for commands allowed through the model command execution bridge. */
  isModelCommandInvocable?: (command: string) => boolean;
  /** Preloaded config to avoid duplicate discovery when caller needs it too. */
  config?: IResolvedConfig;
  /** Recorder used to snapshot files before Write/Edit tools mutate them. */
  editCheckpointRecorder?: IEditCheckpointRecorder;
  /** Opt-in local-first reversible execution policy for write/shell tools. */
  reversibleExecution?: IReversibleExecutionOptions;
  /** Optional provider sandbox client used by sandbox-aware built-in tools. */
  sandboxClient?: ISandboxClient;
  /** Fresh-session workspace manifest applied through the sandbox client. */
  workspaceManifest?: IWorkspaceManifest;
  /** Sandbox target root for workspace manifest entries. Defaults to /workspace. */
  sandboxWorkspaceRoot?: string;
  /** Provider sandbox snapshot id to restore before replaying saved messages. */
  sandboxSnapshotId?: string;
  /** Name reported to the underlying Robota agent config. Defaults to 'agent'. */
  agentName?: string;
}
